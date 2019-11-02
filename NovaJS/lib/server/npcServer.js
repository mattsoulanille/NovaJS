var npc = require("../client/npc.js");
var _ = require("underscore");

class blankController {
    constructor() {

    }
    nextState(state) {
	return state;
    }

}


class npcServer extends npc {
    constructor() {
	super(...arguments);
	this.oldStats = this.getStats();
	this._controller = new blankController();
	//this._delay = 100; // 100 milliseconds
	this._delay = 1000; // time between calls to controlfunction
	this.controlInterval = undefined;

	// Ship removed this. Server is responsable for
	// reporting when npcs die.
	this.onState("zeroArmor", this._onDeathBound);
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
	    return (a !== this) && a.getVisible();
	}.bind(this));
    }
    

    async build() {
	await super.build();
	this.setInterval();
    }

    get controller() {
	return this._controller;
    }

    set controller(c) {
	this._controller = c;
	this.setInterval();
    }

    get delay() {
	return this._delay;
    }
    set delay(milliseconds) {
	this._delay = milliseconds;
	this.setInterval();
    }

    setInterval() {
	if (typeof this.controlInterval !== 'undefined') {
	    clearInterval(this.controlInterval);
	}
	if (this.built) {
	    this.controlInterval = setInterval(function() {

		this.state = this.controller.nextState(this.state);

	    }.bind(this), this.delay);
	}
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
	    this.sendStats();
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

    _receiveCollision(other) {
	super._receiveCollision(other);
	this.sendCollision();
    }


    _respawn() {
	// temporary respawn
	this.position[0] = Math.random() * 1000 - 500;
	this.position[1] = Math.random() * 1000 - 500;
	this.velocity[0] = 0;
	this.velocity[1] = 0;
	this.shield = this.properties.shield;
	this.armor = this.properties.armor;
	this.sendStats();
    }
    onDeath() {
	//this.hide();
	//this.multiplayer.emit('updateStats', this.getStats());
	super.onDeath();
	this.sendStats();
	setTimeout(function() {
	    this.hide();

	}.bind(this), this.properties.deathDelay);

	setTimeout(this.destroy.bind(this), 10000); // So the projectiles can continue to exist. A bad way to do this.
	
	

	
    }

    _destroy() {
	if (typeof this.controlInterval !== 'undefined') {
	    clearInterval(this.controlInterval);
	}
	super._destroy(this);
	this.socket.emit("removeObjects", this.UUIDS); // Is this necessary?
    }

}

npcServer.prototype.sendCollision = _.throttle(function() {
    this.sendStats();
}, 300);


module.exports = npcServer;
