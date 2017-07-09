var npc = require("../client/npc.js");
var _ = require("underscore");

class npcServer extends npc {
    constructor() {
	super(...arguments);
	this.oldStats = this.getStats();
    }



    get state() {
	var s = {};
	var stats = this.getStats();

	// maybe turning should be stored as an int in the ship too?
	if (this.turning === "left") {
	    s.turning = -1;
	}
	else if (this.turning === "right") {
	    s.turning = 1;
	}
	else {
	    s.turning = 0;
	}

	s.weapons = this.weapons.all;
	s.firing = this.weapons.all.map(function(w) {return w.firing;});
	s.accelerating = this.accelerating;
	s.position = [this.position[0], this.position[1]];
	s.velocity = [this.velocity[0], this.velocity[1]];
	s.pointing = this.pointing;
	s.shield = this.shield;
	s.armor = this.armor;
	s.target = this.target;
	s.targets = this.getTargets();
	s.targetIndex = s.targets.indexOf(s.target);
	s.turningToTarget = this.turningToTarget;
	return s;
    }

    set state(s) {
	// since it's connected to a neural net, sanitize all the inputs.
	if (s.turning === -1) {
	    this.turning = "left";
	}
	else if (s.turning === 1) {
	    this.turning = "right";
	}
	else {
	    this.turning = "";
	}

	for (var i = 0; i < this.weapons.all.length; i++) {
	    this.weapons.all[i].firing = s.firing[i];
	}
	
	
	this.accelerating = Boolean(s.accelerating);
	this.turningToTarget = Boolean(s.turningToTarget);
	if (! isNaN(s.targetIndex)) {
	    this.target = this.getTargets()[Number(s.targetIndex)];
	}

	this.sendStatsIfDifferent(); // rather hacky. rewrite so changes automatically call sendStats?	
    }

    getTargets() {
	return [...this.system.ships].filter(function(a) {
	    return a !== this;
	}.bind(this));
    }
    

    render() {
	super.render.call(this);

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

    /*
    sendStats(stats=this.getStats()) {
	//console.log("sending");
	this.oldStats = stats;
	var toSend = {};
	toSend[this.UUID] = stats;
	// make sure to set npcServer.prototype.io
	this.io.emit('updateStats', toSend);
    }
*/
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
