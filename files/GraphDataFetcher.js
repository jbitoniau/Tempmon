'use strict';

/*
	GraphDataFetcher

	This class knows how to fetch data from the SIGFOX backend.
	Whenever data is fetched, it is added to the encapsulated graphData array.

	It could in theory fetch data in any order (using any random beforeTime) 
	and still maintain graphData properly, but for now it kind of assumes that
	fetchData is called from most recent time to further and further away back
	in time.
*/
function GraphDataFetcher(deviceID, limit, firstFetchBeforeTimeMs)
{
	this._deviceID = deviceID;
	this._limit = limit;
	this._firstFetchBeforeTimeMs = firstFetchBeforeTimeMs;	// The first fetch request will use this 'beforeTime' if specified
	this._graphData = [];		// An array of {x:<epoch time in milliseconds>, temperature:<in celsius>, pressure:<in hPa>, humidity:<in percent>}
	this._xminFinalReached = false;
	this._xmaxFinalReached = false;
	this._promiseInProgress = null;
}

GraphDataFetcher._messageIntervalMs = 10*60*1000;	// Theoritical interval in milliseconds between weather messages. In practise, it's slightly more

GraphDataFetcher.prototype.isFetching = function()
{
	return !!this._promiseInProgress;
};

GraphDataFetcher.prototype.getDataXMax = function()
{
	if ( this._graphData.length===0 )
		return null;
	return this._graphData[0].x;
};

GraphDataFetcher.prototype.getDataXMin = function()
{
	if ( this._graphData.length===0 )
		return null;
	return this._graphData[this._graphData.length-1].x;
};

GraphDataFetcher.prototype.xminFinalReached = function()
{
	return this._xminFinalReached;
};

GraphDataFetcher.prototype.fetchDataForward = function()
{
	//console.log("fetchDataForward");
	if ( this.isFetching() )
		return Promise.reject();

	var lastTimeMs = null;
	if ( this.getDataXMax() )
	{	
		lastTimeMs = this.getDataXMax();
	}
	else if ( this._firstFetchBeforeTimeMs )
	{	
		lastTimeMs = this._firstFetchBeforeTimeMs;
	}

	var beforeTimeInSeconds = null;
	if ( lastTimeMs )
	{
		var beforeTimeMs = lastTimeMs + (GraphDataFetcher._messageIntervalMs*1.02) * (this._limit * 0.9);	// The 0.9 factor is to allow a bit of overlap between the messages we're requesting and the ones we've got already
		beforeTimeInSeconds = Math.floor( beforeTimeMs / 1000 );
	}

	var uri = GraphDataFetcher._getUri( this._deviceID, this._limit, beforeTimeInSeconds );
	var promise = HttpRequest.request( uri, 'GET')
		.then(
			function( response )
			{
				var messages = JSON.parse(response);
				var newGraphData = GraphDataFetcher._getGraphDataFromSigfoxMessages( messages );
			
				// Remove from new graph data the data we've already got 
				if ( this._graphData.length>0 )
				{			
					var xmax = this.getDataXMax();
					for ( var i=newGraphData.length-1; i>=0; i-- )
					{
						if ( newGraphData[i].x>xmax )
						{
							newGraphData = newGraphData.slice(0, i+1);				
							break;
						}
					}
				}

				if ( newGraphData.length>0 )
				{
					// Insert new graph data in front of the data we've got 
					for ( var i=newGraphData.length-1; i>=0; i-- )
						this._graphData.splice( 0, 0, newGraphData[i] );	
				}
				else
				{
					this._xmaxFinalReached = true;	
				}

				this._promiseInProgress = null;

				return Promise.resolve(newGraphData);
			}.bind(this))
		.catch(
			function( error )
			{
				this._promiseInProgress = null;
				throw error;
			});

	this._promiseInProgress = promise;
	return promise;
};

GraphDataFetcher.prototype.fetchDataBackward = function()
{
	//console.log("fetchDataBackward");
	if ( this.isFetching() )
		return Promise.reject( new Error("GraphDataFetcher is already fetching data") );

	if ( this.xminFinalReached() )
		return Promise.reject( new Error("GraphDataFetcher has reached the end of data") );

	var lastTimeMs = null;
	if ( this.getDataXMin() )
	{	
		lastTimeMs = this.getDataXMin();
	}
	else if ( this._firstFetchBeforeTimeMs )
	{	
		lastTimeMs = this._firstFetchBeforeTimeMs;
	}

	var beforeTimeInSeconds = null;
	if ( lastTimeMs )
	{
		beforeTimeInSeconds = Math.floor( lastTimeMs / 1000 );
	}

	var uri = GraphDataFetcher._getUri( this._deviceID, this._limit, beforeTimeInSeconds );
	var promise = HttpRequest.request( uri, 'GET')
		.then(
			function( response )
			{
				var messages = JSON.parse(response);
				var newGraphData = GraphDataFetcher._getGraphDataFromSigfoxMessages( messages );

				// Remove from new graph data the data we've already got 
				if ( this._graphData.length>0 )
				{			
					var xmin = this.getDataXMin();
					for ( var i=0; i<newGraphData.length; ++i )
					{
						if ( newGraphData[i].x<xmin )
						{
							newGraphData = newGraphData.slice(i);				
							break;
						}
					}
				}

				if ( newGraphData.length>0 )
				{
					// Push new graph data at the end of the data we've got 
					for ( var i=0; i<newGraphData.length; ++i )
						this._graphData.push( newGraphData[i] );	
				}
				else
				{
					// If there was no new graph data, we've reached the end of the available past data.
					// This flag is important as without it, we'd continuously try to fetch more past data.
					this._xminFinalReached = true;	
				}

				this._promiseInProgress = null;

				return Promise.resolve(newGraphData);
			}.bind(this))
		.catch(
			function( error )
			{
				this._promiseInProgress = null;
				throw error;
			});

	this._promiseInProgress = promise;
	return promise;
};

GraphDataFetcher._getGraphDataFromSigfoxMessages = function( messages )
{
	var graphData = [];
	for ( var i=0; i<messages.data.length; ++i  )
	{
		var message = messages.data[i];
		var uint8Array = GraphDataFetcher._createUint8ArrayFromMessageString( message.data );
		var weatherData = GraphDataFetcher._getWeatherDataFromUint8Array( uint8Array );
		
		// Sigfox message timestamp is a UTC/GMT time expressed in seconds since Unix Epoch (1st of January 1970)
		// Graph data x axis is in milliseconds
		var x = message.time * 1000;	
		if ( weatherData.temperature<-100 || weatherData.temperature>100 )
		{ 
			console.warn("Invalid temperature: " + weatherData.temperature + " at time " + new Date(x) );
			weatherData.temperature = 0;
		}

		if ( weatherData.humidity<0 || weatherData.humidity>100 )
		{ 
			console.warn("Invalid humidity: " + weatherData.humidity + " at time " + new Date(x) );
			weatherData.humidity = 0;
		}

		if ( weatherData.pressure<900 || weatherData.pressure>1200 )
		{ 
			console.warn("Invalid pressure: " + weatherData.pressure + " at time " + new Date(x) );
			weatherData.pressure = 0;
		}

		graphData.push( 
			{
				x: x,
				temperature: weatherData.temperature,
				humidity: weatherData.humidity,
				pressure: weatherData.pressure,
				message: message  					// We keep track of the raw message in the graph data
			});
	}

	return graphData;
};

GraphDataFetcher._getUri = function( deviceID, limit, beforeTimeInSeconds )
{
	var uri = '/api/devices/' + deviceID + '/messages?limit=' + limit;
	if ( beforeTimeInSeconds!==null && beforeTimeInSeconds!==undefined )
	{
		uri += '&before=' + beforeTimeInSeconds;
	}
	return uri;
};

GraphDataFetcher._createUint8ArrayFromMessageString = function( messageString )
{
	// http://stackoverflow.com/questions/1597709/convert-a-string-with-a-hex-representation-of-an-ieee-754-double-into-javascript
	var messageLengthInBytes = 12;
	var buffer = new ArrayBuffer(messageLengthInBytes);
	var uint8Array = new Uint8Array( buffer );
	for ( var i=0; i<messageLengthInBytes; i++ )
	{
		var byteAsHex = messageString.substr( i*2, 2 );
		var byte = parseInt( byteAsHex, 16 );
		uint8Array[i] = byte;
	}
	return uint8Array;
};

GraphDataFetcher._getWeatherDataFromUint8Array = function( uint8Array )
{
	var dataView = new DataView(uint8Array.buffer);
	var weatherData = {
		pressure: dataView.getUint32(0),		
		temperature: dataView.getFloat32(4),
		humidity: dataView.getUint32(8)
	};
	return weatherData;
};
