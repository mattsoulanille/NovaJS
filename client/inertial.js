/*
inertial.js
Handles things that navigate withhout inertia (like planes / cars)
mixin

*/


var acceleratable = require("../server/acceleratableServer.js");
//var Promise = require("bluebird");

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
	
	
	
	var xaccel = Math.cos(this.pointing) * this.acceleration;
	var yaccel = Math.sin(this.pointing) * this.acceleration;
	if (this.accelerating == true) {
	    //var aCoefficient = (this.maxSpeed - Math.pow(Math.pow(this.velocity[0], 2) + Math.pow(this.velocity[1], 2), .5)) / this.maxSpeed
	    this.velocity[0] += xaccel * delta/1000;
	    this.velocity[1] += yaccel * delta/1000;
	    
	    // keep velocity under max speed
	    var speed = Math.pow(Math.pow(this.velocity[0], 2) + Math.pow(this.velocity[1], 2), .5);
	    if (speed > this.maxSpeed) {
		var tmpAngle = Math.atan(this.velocity[1] / this.velocity[0]);
		if (this.velocity[0] < 0) {
		    tmpAngle = tmpAngle + Math.PI;
		}
		//console.log(tmpAngle)
		this.velocity[0] = Math.cos(tmpAngle) * this.maxSpeed;
		this.velocity[1] = Math.sin(tmpAngle) * this.maxSpeed;
	    }
	}
    }
};

module.exports = inertial;

