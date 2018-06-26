/*
Anything that can have collisions (with projectiles etc)
Mixin
*/

var movable = require("../server/movableServer.js");
//var Promise = require("bluebird");
var Crash = require("crash-colliders");
var errors = require("./errors.js");
var NoSystemError = errors.NoSystemError;
var NotBuiltError = errors.NotBuiltError;
var NoCollisionShapeError = errors.NoCollisionShapeError;



var collidable = (superclass) => class extends superclass {
    constructor(buildInfo, system) {
	super(...arguments);
	this.convexHullData = undefined;
	//this.debug = true; // delete me
    }

    collideWith(other) {}; 
    receiveCollision(other) {};

    setVisible(v) {
	super.setVisible(v);
	if (typeof this.collisionShape === "undefined") {
	    throw new NoCollisionShapeError("Can't set visible without having a collisionShape");
	}
	
	if (v && !this.crash.all().includes(this.collisionShape)) {
	    this.collisionShape.insert();
	}
	else {
	    this.collisionShape.remove();
	}
    }    

    get crash() {
	if (!this.system) {
	    throw new NoSystemError("collidable object wanted crash but had no system.");
	}
	return this.system.crash;
    }
    set crash(s) {
	throw new Error("Can't set crash of a collidable. It's determined by the system it's in.");
    }
    
    _removeFromSystem() {
	if (typeof(this.collisionShape) !== 'undefined') {
	    this.collisionShape.remove();
//		this.debug = false;
	}
	//this.crash = undefined;
	super._removeFromSystem.call(this);

    }
    
    _addToSystem() {
	// Not using a getter because I want to make sure that the collision shape gets inserted.
	//this.crash = this.system.crash;

	if (this.built) {
	    this.buildConvexHulls();
	    if (!(this.crash.all().includes(this.collisionShape)) ) {
		this.collisionShape.insert();
	    }
	}
	super._addToSystem.call(this);
    }


    async _build() {
	await super._build();
	if (typeof(this.system) !== 'undefined') {
	    this.buildConvexHulls();
	}
    }

    buildConvexHulls() {
	this.collisionSpriteName = "baseImage";
	this.convexHullData = this.sprites.baseImage.convexHulls;
	
	this.collisionShapes = this.convexHullData.map(function(hullPoints) {
	    /*
	    // for testing
	    return new this.crash.Polygon(new this.crash.V,
	    [new this.crash.V(10,10),
	    new this.crash.V(-10,10),
	    new this.crash.V(-10,-10),
	    new this.crash.V(10, -10)],
	    false, this);
	    */
	    if (hullPoints === null) {
		return new this.crash.Circle(new this.crash.Vector(0,0),
					     1,
					    false,
					    this);
	    }
	    return new this.crash.Polygon(new this.crash.Vector(0,0),
					  hullPoints.map(function(point) {
					      return new this.crash.Vector(point[0], point[1]);
					  }.bind(this)), false, this);

	}.bind(this));
	this.collisionShape = this.collisionShapes[0]; // Default
    }

    setProperties() {
	super.setProperties.call(this);

	if (typeof(this.properties.vulnerableTo) === 'undefined') {
	    this.properties.vulnerableTo = ["normal"]; // normal and/or pd
	}
    }

    renderCollisionSprite(spr, rotation, imageIndex) {
	var newShape = this.collisionShapes[imageIndex];
	
	if (this.collisionShape !== newShape) {
	    this.collisionShape.remove();
	    if (this.getVisible && !this.crash.all().includes(newShape)) {
		newShape.insert();
	    }
	    this.collisionShape = newShape;
	}
	if (this.getVisible() && this.collisionShape.setAngle) {
	    this.collisionShape.setAngle(rotation);
	}

    }

    render() {
	super.render(...arguments);
	if (this.getVisible()) {
	    this.collisionShape.moveTo(...this.position);
	}
    }
};

module.exports = collidable;

