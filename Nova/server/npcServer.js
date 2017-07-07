var npc = require("../client/npc.js");
var _ = require("underscore");

class npcServer extends npc {
    constructor() {
	super(...arguments)
	this.oldStats = this.getStats();
    }


    

    render() {
	super.render.call(this);
	this.sendStatsIfDifferent(); // rather hacky. rewrite so changes automatically call sendStats?
    }

    sendStatsIfDifferent() {
	// sends stats if different than previous ones
	var stats = this.getStats();

	var different = Object.keys(stats).some(function(key) {
	    if (!this.oldStats.hasOwnProperty(key)) {
		return true;
	    }

	    if (['position', 'velocity', 'turning', 'shield', 'armor', 'fuel'].includes(key)) {
		return false;
	    }

	    return stats[key] != this.oldStats[key];
	    
	}.bind(this));
/*
	var debug = Object.keys(stats).map(function(key) {
	    if (!this.oldStats.hasOwnProperty(key)) {
		return true;
	    }

	    if (['position', 'velocity', 'turning', 'shield', 'armor', 'fuel'].includes(key)) {
		return false;
	    }

	    return stats[key] != this.oldStats[key];
	    
	}.bind(this));
*/
	if (different) {
//	    debugger;
	    this.sendStats(stats);
	}
    }
    
    sendStats(stats=this.getStats()) {
	//console.log("sending");
	this.oldStats = stats;
	var toSend = {};
	toSend[this.UUID] = stats;
	// make sure to set npcServer.prototype.io
	this.io.emit('updateStats', toSend);
    }

    onDeath() {
	// temporary respawn
	this.position[0] = Math.random() * 1000 - 500;
	this.position[1] = Math.random() * 1000 - 500;
	this.velocity[0] = 0;
	this.velocity[1] = 0;
	this.shield = this.properties.maxShields;
	this.armor = this.properties.maxArmor;
	this.sendStats();
    }

}

npcServer.prototype.sendCollision = _.throttle(function() {
    var stats = {};
    stats[this.UUID] = this.getStats();
    this.io.emit('updateStats', stats);
});


module.exports = npcServer;
