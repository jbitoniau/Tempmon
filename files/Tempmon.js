'use strict';

/*
	Tempmon
*/	
function Tempmon( canvas, deviceID )
{
	// The object that knows how to get data from SigFox backend
	this._graphDataFetcher = new GraphDataFetcher(deviceID, 100);

	// The type of graph data currently being displayed
	this._graphDataType = 'temperature';

	// The graph data window used to render the graph
	var initialWidth = 100*10*60*1000;		// About 100 SigFox messages (messages are 10 minutes appart)
	var initialX = new Date().getTime() - initialWidth*0.9;
	this._graphDataWindow = {
		x: initialX,
		y: -5,
		width: initialWidth,
		height: 40
	};

	// The backed-up graph data windows for each type of data
	this._graphDataWindows = {
		'temperature' : {
			x: initialX,	
			y: -5,
			width: initialWidth,
			height: 40
		},
		'humidity' : {
			x: initialX,	
			y: -10,
			width: initialWidth,
			height: 120
		},
		'pressure' : {
			x: initialX,	
			y: 950,
			width: initialWidth,
			height: 150							// When height is perfectly 100, I've got flickering on the Y lines
		}
	};

	// The graph option used for rendering
	this._graphOptions = {
		yPropertyName: this._graphDataType,
		clearCanvas: true,
		drawOriginAxes: true,
		drawDataRange: true,
		drawDataGaps: true,
		contiguityThreshold: 10.2*60*1000,		// A little bit more than 10 minutes
		textSize: 12,
		numMaxLinesX: 5,
		numMaxLinesY: 5,
		getPrimaryLinesTextX: GraphDataPresenter.getLinesTextForTime, 
		getPrimaryLinesSpacingX: GraphDataPresenter.getPrimaryLinesSpacingForTime,
		getSecondaryLinesSpacingX: GraphDataPresenter.getSecondaryLinesSpacingForTime,
		getPrimaryLinesTextY: GraphDataPresenter.getLinesText,
		getPrimaryLinesSpacingY: GraphDataPresenter.getLinesSpacing,
		getSecondaryLinesSpacingY: GraphDataPresenter.getSecondaryLinesSpacing,
		points: {
			//typicalDataPointXSpacing: 10*60*1000,		// No need if we provide a contiguityThreshold
			maxPointSize: 5,
			maxNumPoints: 500,
		}
		/*colors: {
			clear:'#FFFFFF',
			dataRange: "#EEEEEE",
			dataGaps: "#EEEEEE",
			axesLines: "#AA6666",
			primaryLinesText: '#AA6666',
			primaryLines: '#FFAAAA',
			secondaryLines: '#FFDDDD',
			dataLine: "#884444",
			dataPoint: "#884444",
		},*/
	};

	// The graph controller is responsible for rendering the graph and handling input events to navigate in it
	this._graphController = new GraphController( canvas, this._graphDataFetcher._graphData, this._graphDataWindow, this._graphOptions );

	// When the user navigates in the graph (i.e. changes the graph data window), we need to check whether more data needs to be fetched
	this._graphController._onGraphDataWindowChange = this._onGraphDataWindowChange.bind(this);

	// Whenever the window resizes, we need to recalculate a few graph options to adjust to the new size
	window.addEventListener( "resize", this._onResize.bind(this) );

	// Initialize for current size
	this._onResize();

	// Start fetching some data
	this._fetchDataIfNeeded();

	this._onGraphDataTypeChanged = null;
}

Tempmon.prototype.setGraphDataType = function( graphDataType )
{
	if ( graphDataType===this._graphDataType )
		return;

	this._graphDataWindows[this._graphDataType].y = this._graphDataWindow.y;
	this._graphDataWindows[this._graphDataType].height = this._graphDataWindow.height;

	var prevGraphDataType = this._graphDataType;
	this._graphDataType = graphDataType;

	this._graphDataWindow.y = this._graphDataWindows[this._graphDataType].y;
	this._graphDataWindow.height = this._graphDataWindows[this._graphDataType].height;

	this._graphOptions.yPropertyName = this._graphDataType;
	this._graphController.render();

	if ( this._onGraphDataTypeChanged )
		this._onGraphDataTypeChanged( prevGraphDataType, this._graphDataType );
};

Tempmon.prototype._fetchDataIfNeeded = function()
{
	var graphDataFetcher = this._graphDataFetcher;
	if ( graphDataFetcher.isFetching() )
		return Promise.resolve();	

	if ( graphDataFetcher._xmin===null || 
		 (this._graphDataWindow.x<graphDataFetcher._xmin && !graphDataFetcher.xminFinalReached() ) )
	{		
		var promise = graphDataFetcher.fetchDataBackward()
			.then(
				function()
				{
					this._graphController.render();
					return this._fetchDataIfNeeded();
				}.bind(this))
			.catch(
				function( error )
				{
					alert( error.toString() );
				}.bind(this));
		return promise;
	}
	return Promise.resolve();
};

Tempmon.prototype._onGraphDataWindowChange = function()
{
	this._fetchDataIfNeeded();
};

Tempmon.prototype._onRendered = function()
{
};	

Tempmon.prototype._onResize = function( event )
{
	this._updateLinesOptions();
	this._updatePointsOptions();
	this._graphController.render();
};

Tempmon.prototype._updateLinesOptions = function()		 
{
	var canvas = this._graphController._canvas;
	var width = canvas.clientWidth;
	var height = canvas.clientHeight;

	var textSize = this._graphOptions.textSize;
	
	// Calculate a decent max number of grid lines along the x axis based 
	// on an average text/label width in pixels (itself calculated from font size)
	var averageCharWidth = textSize * 0.5;
	var maxTextWidth = averageCharWidth * 24 + 5;		// Include a few more pixels as a margin
	var numMaxLinesX = Math.floor( width / maxTextWidth );
	if ( numMaxLinesX<1 )
		numMaxLinesX = 1;
	
	// Based on the aspect ratio of the canvas and max number of lines on X,
	// we calculate a max number of linex on the Y axis so it looks balanced
	var numMaxLinesY = Math.floor( height / (maxTextWidth*0.7) );		// We can fit more y-lines than x-lines hence the 0.7 factor

	this._graphOptions.numMaxLinesX = numMaxLinesX;
	this._graphOptions.numMaxLinesY = numMaxLinesY;
};

Tempmon.prototype._updatePointsOptions = function()
{
	var canvas = this._graphController._canvas;
	var width = canvas.clientWidth;
	this._graphOptions.points.maxNumPoints = Math.trunc( width * 0.3 );
};
