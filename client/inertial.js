/*
inertial.js
Handles things that navigate withhout inertia (like planes / cars)
mixin

*/

if (typeof(module) !== 'undefined') {
    var acceleratable = require("../server/acceleratableServer.js");
    var _ = require("underscore");
    var Promise = require("bluebird");
}



inertial = class {
    constructor() {

    }
    updateStats(stats) {}

    getStats(stats) {return stats;}
    
    render(delta) {

	if (this.accelerating == -1) {
	    var vAngle = Math.atan(this.velocity[1] / this.velocity[0]);
	    if (this.velocity[0] < 0) {
		vAngle = vAngle + Math.PI;
	    }
	    var pointto = (vAngle + Math.PI) % (2*Math.PI);
	    this.turnTo(pointto);
	}
	
	
	
	var xaccel = Math.cos(this.pointing) * this.properties.acceleration;
	var yaccel = Math.sin(this.pointing) * this.properties.acceleration;
	if (this.accelerating == true) {
	    //var aCoefficient = (this.properties.maxSpeed - Math.pow(Math.pow(this.velocity[0], 2) + Math.pow(this.velocity[1], 2), .5)) / this.properties.maxSpeed
	    this.velocity[0] += xaccel * delta/1000;
	    this.velocity[1] += yaccel * delta/1000;
	    
	    // keep velocity under max speed
	    var speed = Math.pow(Math.pow(this.velocity[0], 2) + Math.pow(this.velocity[1], 2), .5);
	    if (speed > this.properties.maxSpeed) {
		var tmpAngle = Math.atan(this.velocity[1] / this.velocity[0]);
		if (this.velocity[0] < 0) {
		    tmpAngle = tmpAngle + Math.PI;
		}
		//console.log(tmpAngle)
		this.velocity[0] = Math.cos(tmpAngle) * this.properties.maxSpeed;
		this.velocity[1] = Math.sin(tmpAngle) * this.properties.maxSpeed;
	    }
	}
    }
};

if (typeof(module) !== 'undefined') {
    module.exports = inertial;
}
