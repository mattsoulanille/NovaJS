/*
movable.js
Handles any space object that moves



*/


if (typeof(module) !== 'undefined') {
    var spaceObject = require("../server/spaceObjectServer.js");
    var _ = require("underscore");
    var Promise = require("bluebird");

}


//let movable = function(superclass) { return class extends superclass {
var movable = (superclass) => class extends superclass {
    constructor() {
	super(...arguments); // pass the args to the rest of stuff
	this.velocity = [0,0];
	this.delta = 0;
	if (typeof(buildInfo) !== 'undefined') {
	    this.buildInfo.type = "movable";
	}
    }


    updateStats(stats) {
	super.updateStats.call(this, stats);
	if (typeof(stats.velocity) !== 'undefined') {
	    this.velocity[0] = stats.velocity[0];
	    this.velocity[1] = stats.velocity[1];
	}
    }

    getStats() {
	var stats = super.getStats.call(this);
	stats.velocity = [this.velocity[0], this.velocity[1]];
	return stats;
    }

    render() {
	if (this.renderReady) {
	
	    this.delta = this.time - this.lastTime;
	    if (typeof this.lastTime != 'undefined') {
		this.position[0] += this.velocity[0] * (this.delta)/1000;
		this.position[1] += this.velocity[1] * (this.delta)/1000;
	    }

	    this.lastTime = this.time;
	    //	this.previousMoveTime = this.time
	    super.render.call(this)
	    return true
	}
	else {
	    return false
	}
    }
}



if (typeof(module) !== 'undefined') {
    module.exports = movable;
}
