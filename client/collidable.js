/*
Anything that can have collisions (with projectiles etc)
Mixin
*/

if (typeof(module) !== 'undefined') {
    var movable = require("../server/movableServer.js");
    var _ = require("underscore");
    var Promise = require("bluebird");
    var Crash = require("crash-colliders");
}


var collidable = (superclass) => class extends superclass {
    constructor(buildInfo, system) {
	super(...arguments);
	this.convexHullData = undefined;
	//this.debug = true; // delete me
    }

    collideWith(other) {}; 
    receiveCollision(other) {};

    show() {
	// Necessary in case show is called twice
	if (super.show.call(this) && this.crash && ! (this.crash.all().includes(this.collisionShape)) ) {
	    this.collisionShape.insert();
	}

    }

    hide() {
	if (typeof(this.collisionShape) !== 'undefined') {
	    this.collisionShape.remove();
	    //this.debug = false;
	}
	super.hide.call(this);
    }

    _removeFromSystem() {
	if (typeof(this.collisionShape) !== 'undefined') {
	    this.collisionShape.remove();
//		this.debug = false;
	}
	this.crash = undefined;
	super._removeFromSystem.call(this);

    }

    _addToSystem() {
	// Not using a getter because I want to make sure that the collision shape gets inserted.
	this.crash = this.system.crash;

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

	this.collisionShapes = _.map(this.convexHullData, function(hullPoints) {
	    /*
	    // for testing
	    return new this.crash.Polygon(new this.crash.V,
	    [new this.crash.V(10,10),
	    new this.crash.V(-10,10),
	    new this.crash.V(-10,-10),
	    new this.crash.V(10, -10)],
	    false, this);
	    */

	    return new this.crash.Polygon(new this.crash.Vector(0,0),
					  _.map(hullPoints, function(point) {
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

    render() {
	super.render.call(this);
	if (this.visible) {
	    this.collisionShape.moveTo(...this.position);
	}
    }
};


if (typeof(module) !== 'undefined') {
    module.exports = collidable;
}
