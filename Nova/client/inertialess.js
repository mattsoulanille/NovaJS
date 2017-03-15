/*
inertialess.js

Handles things that navigate without inertia

*/
if (typeof(module) !== 'undefined') {
    var acceleratable = require("../server/acceleratableServer.js");
    var _ = require("underscore");
    var Promise = require("bluebird");
}

inertialess = class {
    // a bunch of helper functions for acceleratable
    constructor() {
    }
    updateStats(stats) {
	if (typeof(stats.polarVelocity) !== 'undefined') {
	    this.polarVelocity = stats.polarVelocity;
	}
    }

    getStats(stats) {
	stats.polarVelocity = this.polarVelocity;
	return stats;
    }
    render() {
	var angle = this.pointing;
	var change_in_speed = (this.properties.acceleration *
			       (this.time - this.lastTime) / 1000);
	
	this.velocity = [Math.cos(angle) * this.polarVelocity, Math.sin(angle) * this.polarVelocity]

	if ((this.accelerating == -1) && (this.polarVelocity > 0)) {
	    
	    this.polarVelocity -= change_in_speed;
	    if (this.polarVelocity < 0) {
		this.polarVelocity = 0;
	    }
	    
	}
	else if ((this.accelerating == 1) && (this.polarVelocity < this.properties.maxSpeed)) {
	    
	    this.polarVelocity += change_in_speed;
	    if (this.polarVelocity > this.properties.maxSpeed) {
		this.polarVelocity = this.properties.maxSpeed;
	    }
	    
	}
    }

}
if (typeof(module) !== 'undefined') {
    module.exports = inertialess;
}
