/*
movable.js
Handles any space object that moves



*/


if (typeof(module) !== 'undefined') {
    module.exports = movable;
    var spaceObject = require("../server/spaceObjectServer.js");
    var _ = require("underscore");
    var Promise = require("bluebird");

}


function movable(buildInfo, system) {
    spaceObject.call(this, buildInfo, system);
    this.velocity = [0,0];
    if (typeof(buildInfo) !== 'undefined') {
	this.buildInfo.type = "movable";
    }

}

movable.prototype = new spaceObject;



movable.prototype.setProperties = function() {
    spaceObject.prototype.setProperties.call(this)
}

movable.prototype.updateStats = function(stats) {
    spaceObject.prototype.updateStats.call(this, stats);
    if (typeof(stats.velocity) !== 'undefined') {
	this.velocity[0] = stats.velocity[0];
	this.velocity[1] = stats.velocity[1];
    }
}

movable.prototype.getStats = function() {
    var stats = spaceObject.prototype.getStats.call(this);
    stats.velocity = [this.velocity[0], this.velocity[1]];
    return stats;
}

movable.prototype.render = function() {
    if (this.renderReady) {
	

	if (typeof this.lastTime != 'undefined') {
	    this.position[0] += this.velocity[0] * (this.time - this.lastTime)/1000
	    this.position[1] += this.velocity[1] * (this.time - this.lastTime)/1000
	    
	}
	this.lastTime = this.time;
//	this.previousMoveTime = this.time
	spaceObject.prototype.render.call(this)
	return true
    }
    else {
	return false
    }

}
