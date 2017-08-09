if (typeof(module) !== 'undefined') {
    var _ = require("underscore");
    var Promise = require("bluebird");
    var projectile = require("../server/projectileServer.js");
    var guided = require("../server/guidedServer.js");
    var inSystem = require("./inSystem.js");
    var loadsResources = require("./loadsResources.js");
    var multiplayer = require("../server/multiplayerServer.js");
}


basicWeapon = class extends loadsResources(inSystem) {
    constructor(buildInfo, source) {
	super(...arguments);
	this.socket = source.socket; // necessary for server
	this.buildInfo = buildInfo;
	this.destroyed = false;
	this.fireWithoutTarget = true;
	this._firing = false;
	this.ready = false;
	this.source = source;
	this.fireTimeout = undefined;
	this.doBurstFire = false;
	this.random = Math.random; // Temporary until there is a seeded rng
	if (typeof(buildInfo) !== 'undefined') {
	    this.count = buildInfo.count || 1;
	    this.UUID = buildInfo.UUID;
	    if (this.UUID) {
		this.multiplayer = new multiplayer(this.socket, this.UUID);
	    }
	}
	if (typeof source !== 'undefined') {
	    this.system = this.source.system;
	}
	this.type = "weapons";
    }

    
    _addToSystem(sys) {
        this.system.multiplayer[this.UUID] = this;
    }

    _removeFromSystem() {
        delete this.system.multiplayer[this.UUID];
    }

    async build() {
	// needs refactoring with spaceObject
	await this.loadResources();
	this.setProperties();

	this.reloadMilliseconds = (this.properties.reload * 1000/30 / this.count) || 1000/60;
	if ( this.properties.burstCount > 0 ) {
	    this.doBurstFire = true;
	    this.burstCount = 0;
	    this.burstReloadMilliseconds = this.properties.burstReload * 1000/30;
	    this.reloadMilliseconds = (this.properties.reload * 1000/30) || 1000/60;
	}

	
	await this.buildProjectiles();
	//	    console.log(this.projectiles[0].buildInfo.convexHulls);
	this.ready = true;
	this.source.weapons.all.push(this);
	//	    console.log(this);
	if (typeof this.UUID !== 'undefined') {
	    this.multiplayer.on('updateStats', this.updateStats.bind(this));
	}
    }

    
    buildProjectiles() {

	this.projectiles = [];
	var burstModifier = 1; // modifier to calculate how many projectiles needed
	var durationMilliseconds = this.properties.duration * 1000/30;
	if (this.doBurstFire) {
	    burstModifier = ( ((this.reloadMilliseconds) * this.properties.burstCount) /
			      this.properties.burstReload * 1000/30);
	    if (burstModifier > 1) {burstModifier = 1;}
	}
	
	// as many projectiles as can be in the air at once as a result of the weapon's
	// duration and reload times. if reload == 0, then it's one nova tick (1/30 sec)
	
	var required_projectiles = burstModifier * this.count * (Math.floor(durationMilliseconds / 
									    (this.reloadMilliseconds)) + 1);
	

	//    var buildInfo = this.buildInfo;  
	for (var i=0; i < required_projectiles; i++) {
	    var proj;
	    switch (this.properties.type) {
	    case "unguided":
		proj = new projectile(this.buildInfo, this.source.system, this.source);
		break;
	    case "guided":
		proj = new guided(this.buildInfo, this.source.system, this.source);
		break;
	    case "turret":
		proj = new projectile(this.buildInfo, this.source.system, this.source);
	    case "front quadrant":
		proj = new projectile(this.buildInfo, this.source.system, this.source);
	    default:
		// temp
		proj = new projectile(this.buildInfo, this.source.system, this.source);
		break;
	    }
	    this.projectiles.push(proj);
	    this.addChild(proj);
	}
	
	return Promise.all(_.map( this.projectiles, function(projectile) {return projectile.build()} ));
	
    }


    fire(direction, position, velocity) {
	// finds an available projectile and fires it
	for (var i=0; i < this.projectiles.length; i++) {
	    var proj = this.projectiles[i];
	    if (proj.available) {
		direction = direction || this.source.pointing +
		    ((this.random() - 0.5) * 2 * this.properties.accuracy) *
		    (2 * Math.PI / 360);
		position = position || this.source.position;
		velocity = velocity || this.source.velocity;
		proj.fire(direction, position, velocity, this.target);
		
		return true;
	    }
	    
	}
	console.log("No projectile available");
	return false;
    }

    sendStats(proj, index) {
	//var newStats = {};
	//newStats[this.UUID] = this.getStats();
	//this.socket.emit('updateStats', newStats);
	this.multiplayer.emit("updateStats", this.getStats());
    }
    
    getStats() {
	var stats = {};
	stats.firing = this.firing;
	return stats;
    }
    
    updateStats(stats) {
	// _.each(statsList, function(stats, index) {
	// 	this.projectiles[index].updateStats(stats);
	// }.bind(this));

	// can't do this since it makes an infinite loop...
	// this.firing = stats.firing; 

	if (stats.firing === true) {
	    this.startFiring(false);
	    this._firing = true;
	}
	else {
	    this.stopFiring(false);
	    this._firing = false;
	}
    }

    set firing(val) {
	// high level: Auto fires the weapon if it could fire.
	if (val === true) {
	    // start auto firing
	    this._firing = true;
	    this.startFiring();
	}
	else {
	    // stop auto firing
	    this._firing = false;
	    this.stopFiring();
	}
    }

    get firing() {
	return this._firing;
    }

    canFire() {
	// Returns whether or not the weapon can fire based on its costs etc.
	var targetFire = this.fireWithoutTarget || this.target;

	return this.ready && targetFire;
    }
    applyFireCost() {
	// Applys the cost of firing the weapon (ammo, energy, etc)
    }
    
    startFiring(notify = true) {
	// low level. Starts firing if not already. Should not be called by ship.
	if (this.alreadyFiring) {
	    this.doAutoFire = true;
	}
	else {
	    this.doAutoFire = true;
	    this.autoFire();
	}
	if (notify && (typeof this.UUID !== 'undefined')) {
	    this.sendStats();
	}
	
    }

    stopFiring(notify = true) {
	// low level. Stops firing
	this.doAutoFire = false;
	if (notify && (typeof this.UUID !== 'undefined')) {
	    this.sendStats();
	}
    }
    
    autoFire() {
	
	if (this.doAutoFire) {
	    
	    // fire
	    this.alreadyFiring = true;
	    if (this.canFire()) {
		this.fire();
		this.applyFireCost();
	    }
	    else {
		// Check every 10 milliseconds if I can fire. Probably bad. Probably put it in the
		// main loop...
		this.fireTimeout = setTimeout(this.autoFire.bind(this), 10);
		return;
	    }
	    
	    // fire again after reload time
	    if (this.doBurstFire) {
		if (this.burstCount < this.count * this.properties.burstCount - 1) {
		    this.fireTimeout = setTimeout(_.bind(this.autoFire, this), this.reloadMilliseconds);
		    this.burstCount ++;
		}
		else {
		    this.burstCount = 0;
		    this.burstTimeout = setTimeout(this.autoFire.bind(this),
						   this.burstReloadMilliseconds);
		}
	    }
	    else {
		this.fireTimeout = setTimeout(_.bind(this.autoFire, this), this.reloadMilliseconds);
	    }
	}
	else {
	    this.alreadyFiring = false;
	}
    }
    
    setTarget(target) {
	this.target = target;
    }
    
    destroy() {
	if (this.destroyed) {
	    return;
	}

	// watch out. this sends stuff over socket.io
	// wait no it doesn't. I think. 
	this._firing = false;
	this.stopFiring(false);
	_.each(this.projectiles, function(proj) {
	    proj.destroy();
	});
	this.destroyed = true;
    }
}
if (typeof(module) !== 'undefined') {
    module.exports = basicWeapon;
}
