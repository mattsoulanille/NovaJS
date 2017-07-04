/*
More of a dust field, really.
*/

starfield = class extends inSystem {

    constructor(source, count, starname) {
	super(...arguments);
	this.stars = [];
	this.container = new PIXI.Container();
	this.starLayer = new PIXI.DisplayGroup(-1, false);
	this.container.displayGroup = this.starLayer;
	this.count = count || 20;
	this.ready = false;
	this.source = source;
	this.url = 'objects/misc/';
	this.starName = starname || "star";
	this.autoRender = false;
	this.buffer = 100;
	this.xsize = $(window).width() + 2*this.buffer;
	this.ysize = $(window).height()+ 2*this.buffer;
	this.xrange = [-this.xsize/2, this.xsize/2];
	this.yrange = [-this.ysize/2, this.ysize/2];
	if (typeof(this.source) !== "undefined") {
	    this.position = _.map(this.source.position, function(n) {return n})
	    this.lastPosition = _.map(this.source.position, function(n) {return n})
	    this.system = source.system;
	}
	this.built = false;
}


    build() {
	if (!this.built) {
	    return this.buildStars()
		.then(function() {
		    this.ready = true;
		    this.built = true;
		    // moved to system model.
		    space.addChild(this.container);
		    this.system.built.render.add(this);
		    this.rendering = true;
		}.bind(this))
	}
	else {
	    return new Promise(function(fulfill, reject) {fulfill()});
	}
    }

    attach(source) {
	this.source = source;
	this.system = source.system;
	this.position = _.map(this.source.position, function(n) {return n})
	this.lastPosition = _.map(this.source.position, function(n) {return n})
    }

    _addToSystem() {
	
    }
    _removeFromSystem() {

    }
    
    buildStars() {

	for (var i = 0; i < this.count; i++) {
	    var s = new star(this.source, this.container, this.system);
	    this.stars.push(s);
	    this.children.add(s);
	}
	
	
	return Promise.all(_.map( this.stars, function(s) {return s.build()}));
	
    }

    placeStar(xrange,yrange, aStar) {
	//xrange and yrange are 2-element arrays
	var s = aStar;
	
	if (!s) {
	    for (var i=0; i < this.stars.length; i++) {
		var s = this.stars[i];
		if (s.available === true) {
		    break
		}
	    }
	}
	
	if (s.available === true) {
	    
	    s.randomize()
	    s.position[0] = Math.floor(Math.random() * (xrange[1] - xrange[0]) + xrange[0])
	    s.position[1] = Math.floor(Math.random() * (yrange[1] - yrange[0]) + yrange[0])
	    s.show()
	    s.available = false;
	    return true
	}
	else {
	    return false	
	}
	
    }

    resize() {
	this.xsize = $(window).width() + 2*this.buffer;
	this.ysize = $(window).height()+ 2*this.buffer;
	this.xrange = [-this.xsize/2, this.xsize/2];
	this.yrange = [-this.ysize/2, this.ysize/2];
    }

    placeAll() {
	var xrange = [-this.xsize/2, this.xsize/2]
	var yrange = [-this.ysize/2, this.ysize/2]
	
	while (this.placeStar(xrange, yrange)) {
	    //pass
	}
	
    }



    render() {
	this.position = _.map(this.source.position, function(n) {return n})
	if ((Math.abs(this.position[0] - this.lastPosition[0]) > this.buffer) ||
	    (Math.abs(this.position[1] - this.lastPosition[1]) > this.buffer)) {
	    
	    this.moveStars();
	    this.lastPosition = _.map(this.source.position, function(n) {return n})
	}
	_.each(this.stars, function(s) {s.render()});
	
    }
    
    moveStars() {
	var stars = this.removeUnseen();
	this.placeUnseen(stars);
	
    }

    removeUnseen() {
	var removed = [];
	_.each(this.stars, function(s) {
	    if ((s.position[0] < this.xrange[0] + this.source.position[0]) ||
		(s.position[0] > this.xrange[1] + this.source.position[0]) ||
		(s.position[1] < this.yrange[0] + this.source.position[1]) ||
		(s.position[1] > this.yrange[1] + this.source.position[1])) {
		
		s.hide();
		s.available = true;
		removed.push(s);
	    }
	    
	}, this);
	return removed;
    }

    placeUnseen(stars) {
	var difference = [this.position[0] - this.lastPosition[0],
			  this.position[1] - this.lastPosition[1]];
	
	var xPlaceRange;
	var yPlaceRange;
	
	
	if (this.position[0] > this.lastPosition[0]) {
	    xPlaceRange = [this.lastPosition[0] + this.xrange[1],
			   this.position[0] + this.xrange[1]];
	}
	else {
	    xPlaceRange = [this.position[0] + this.xrange[0],
			   this.lastPosition[0] + this.xrange[0]];
	}	
	
	if (this.position[1] > this.lastPosition[1]) {
	    yPlaceRange = [this.lastPosition[1] + this.yrange[1],
			   this.position[1] + this.yrange[1]];
	}
	else {
	    yPlaceRange = [this.position[1] + this.yrange[0],
			   this.lastPosition[1] + this.yrange[0]];
	}
	
	
	var xPlaceSize = Math.abs((xPlaceRange[1] - xPlaceRange[0]) *
				  (this.ysize - Math.abs(this.position[1] - this.lastPosition[1])));
	
	//yPlaceSize includes the rectangle that results from the extension of two sides of the stage.
	var yPlaceSize = Math.abs((yPlaceRange[1] - yPlaceRange[0]) *(this.xsize));
	
	var totalSize = xPlaceSize + yPlaceSize;
	
	_.each(stars, function(aStar) {
	    var r = Math.random();
	    var placeRange;
	    if (r < xPlaceSize / totalSize) {
		// Place it in the x rectangle
		var y
		if (this.position[1] > this.lastPosition[1]) {
		    y = [this.yrange[0] + this.position[1],
			 this.yrange[1] + this.lastPosition[1]];
		}
		else {
		    y = [this.yrange[0] + this.lastPosition[1],
			 this.yrange[1] + this.position[1]];
		}
		
		placeRange = [xPlaceRange, y];
		
	    }
	    else {
		// Place it in the y rectangle
		var x = [this.xrange[0] + this.position[0],
			 this.xrange[1] + this.position[0]];
		placeRange = [x, yPlaceRange];
		
	    }
	    
	    this.placeStar(placeRange[0], placeRange[1], aStar);
	    
	}, this);
	
	
    }
}
