/*
acceleratable.js
Handles things that can accelerate (inertial and inertialess)
Uses inertialess and inertial
mixin


*/

var inertialess = require("../server/inertialessServer.js");
var inertial = require("../server/inertialServer.js");
//var Promise = require("bluebird");



var acceleratable = (superclass) => class extends superclass {

    constructor() {
	super(...arguments);
	this.lastAccelerating = false;
	this.accelerating = false;
	this.polarVelocity = 0;
	this.flightMode = new inertial; // default
	//this.flightMode = new inertialess; // default
	if (typeof(buildInfo) !== 'undefined') {
	    this.buildInfo.type = "acceleratable";
	}
    }

    updateStats(stats) {
	super.updateStats.call(this, stats);
	if (typeof(stats.accelerating) !== 'undefined') {
	    this.accelerating = stats.accelerating;
	}
	this.flightMode.updateStats.call(this, stats);
    }

    getStats() {
	var stats = super.getStats.call(this);
	stats = this.flightMode.getStats.call(this, stats);
	stats.accelerating = this.accelerating;
	return stats;
    }

    setProperties() {
	super.setProperties.call(this);
	// possibly redundant
	this.properties.acceleration = this.meta.physics.acceleration;
	this.properties.maxSpeed = this.meta.physics.speed;

	if (!this.properties.inertialess) {
	    this.properties.inertialess = false; // TEMPORARY. FIX ME
	}
	if (this.properties.inertialess) {
	    this.flightMode = new inertialess; // default = inertial
	}
    }

    _getAcceleration() {
	return this.properties.acceleration;
    }

    get acceleration() {
	return this._getAcceleration();
    }

    set acceleration(s) {
	throw new Error("Can't set acceleration. Set properties.acceleration instead.");
    }

    _getMaxSpeed() {
	return this.properties.maxSpeed;
    }

    get maxSpeed() {
	return this._getMaxSpeed();
    }

    set maxSpeed(s) {
	throw new Error("Can't set maxSpeed. Set properties.maxSpeed instead.");
    }
    
    _receiveCollision(other) {

	if (other.impact > 0) {
	    var deltaV;
	    if (this.properties.mass === 0) {
		// avoid the NaNs
		deltaV = this.properties.speed;
	    }
	    else {
		deltaV = other.impact / this.properties.mass;
	    }

	    deltaV = 0; // Until ship masses are parsed correctly, collisions won't have knockback.

	    var newVelocity = [Math.cos(other.angle) * deltaV + this.velocity[0],
			       Math.sin(other.angle) * deltaV + this.velocity[1]];
	    
	    var speed = Math.pow(Math.pow(newVelocity[0], 2) + Math.pow(newVelocity[1], 2), .5);
	    if (speed > this.properties.maxSpeed) {
		var tmpAngle = Math.atan(newVelocity[1] / newVelocity[0]);
		if (newVelocity[0] < 0) {
		    tmpAngle = tmpAngle + Math.PI;
		}
		//console.log(tmpAngle)
		newVelocity[0] = Math.cos(tmpAngle) * this.properties.maxSpeed;
		newVelocity[1] = Math.sin(tmpAngle) * this.properties.maxSpeed;
	    }
	    this.velocity[0] = newVelocity[0];
	    this.velocity[1] = newVelocity[1];    
	    
	}
	super._receiveCollision(other);
    }

    render(delta) {

	this.flightMode.render.call(this, delta); // This is wackadoo. Revise it
	super.render(...arguments);

    }
};


module.exports = acceleratable;

