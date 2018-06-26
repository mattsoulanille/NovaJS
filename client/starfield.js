/*
More of a dust field, really.
*/
var star = require("./star.js");
var inSystem = require("./inSystem.js");
var rbush = require("rbush");
var PIXI = require("../server/pixistub.js");
var renderable = require("./renderable.js");
var visible = require("./visible.js");
var _ = require("underscore");

var starfield = class extends renderable(visible(inSystem)) {

    constructor(source, dimensions, density=0.00002, starname="star") {
	super(...arguments);
	this.tree = new rbush();
	this.density = density; // stars per square unit
	this.dimensions = dimensions;
	this.count = this.density * this.dimensions[0] * this.dimensions[1];

	this.stars = [];
	//this.container = new PIXI.Container();
	this.starLayer = new PIXI.DisplayGroup(-10, false);
	this.container.displayGroup = this.starLayer;
	
	this.ready = false;
	this.url = 'objects/misc/';
	this.starName = starname;
	
	if (typeof(source) !== "undefined") {
	    this.attach(source);
	}
	this.built = false;

	var halfw = global.screenW / 2;
	var halfh = global.screenH / 2;

	// For testing purposes:
	this._testing = false;
	this._testFactor = 1;
	if (this._testing) {
	    this.graphics = new PIXI.Graphics();
	    global.space.addChild(this.graphics);
	    this._testFactor = 0.6;
	}
	this.screenDimensions = [(global.screenW - 194) * this._testFactor,
				 global.screenH * this._testFactor];
    }


    async build() {
	await this.buildStars();
	this.ready = true;
	this.built = true;

	// temporary? seems weird to have the stars connected to the system
	this.source.system.container.addChild(this.container);
	//this.setRendering(true);
	this.placeAll();
	this.show();

    }

    resize(x, y) {
	this.screenDimensions = [(x - 194) * this._testFactor,
				 y * this._testFactor];

	this.stars.forEach(function(s) {
	    s.resize(this.screenDimensions[0], this.screenDimensions[1]);
	}, this);
    }
    
    _getBounds() {
	var center = global.myShip.position;
	var halfw = this.screenDimensions[0] / 2;
	var halfh = this.screenDimensions[1] / 2;

	var visibleBox = {
	    minX: center[0] - halfw,
	    minY: center[1] - halfh,
	    maxX: center[0] + halfw,
	    maxY: center[1] + halfh
	};
	return visibleBox;
    }

    _drawBoundingBox() {
	// For testing purposes
	var center = [(global.screenW - 194) / 2, global.screenH / 2];
	var halfw = center[0] * this._testFactor;
	var halfh = center[1] * this._testFactor;

	this.graphics.clear();
	this.graphics.lineStyle(5, 0xffff00);
	this.graphics.moveTo(center[0] - halfw, center[1] - halfh);
	this.graphics.lineTo(center[0] + halfw, center[1] - halfh);
	this.graphics.lineTo(center[0] + halfw, center[1] + halfh);
	this.graphics.lineTo(center[0] - halfw, center[1] + halfh);
	this.graphics.lineTo(center[0] - halfw, center[1] - halfh);

    }
    _getVisibleStars() {
	var visibleBox = this._getBounds();
	var collisions = this.tree.search(visibleBox);
	var stars = collisions.map(function(s) { return s.star;});
	return stars;
    }
	
    
    attach(source) {
	this.source = source;
	this.system = source.system;
	this.position = this.source.position;
	this.stars.forEach(function(s) {s.attach(source);}.bind(this));
    }

    _addToSystem() {
	
    }
    _removeFromSystem() {

    }
    
    buildStars() {

	for (var i = 0; i < this.count; i++) {
	    var s = new star(this.source, this.container, this.system, this.tree, this.screenDimensions);
	    this.stars.push(s);
	    this.children.add(s);
	}
	
	return Promise.all(this.stars.map(function(s) {return s.build();}));
	
    }

    placeStar(aStar) {
	//xrange and yrange are 2-element arrays
	var s = aStar;
	s.randomize();
	s.place([Math.random() * this.dimensions[0] - this.dimensions[0] / 2,
		 Math.random() * this.dimensions[1] - this.dimensions[1] / 2]);
	
	s.show();
	s.available = false;
	return true;

    }

    placeAll() {
	for (let i in this.stars) {
	    this.placeStar(this.stars[i]);
	}
    }



    render(delta) {
	super.render(...arguments);
	if (this._testing) {
	    this._drawBoundingBox();
	}
	var visibleStars = this._getVisibleStars();

	//this.stars.forEach(function(s) {
	
	visibleStars.forEach(function(s) {
	    s.rendered = false;
	    s.render(delta);
	});

    }
};
module.exports = starfield;
