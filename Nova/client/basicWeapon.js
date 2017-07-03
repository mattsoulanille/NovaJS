if (typeof(module) !== 'undefined') {
    var _ = require("underscore");
    var Promise = require("bluebird");
    var projectile = require("../server/projectileServer.js");
    var guided = require("../server/guidedServer.js");
    var inSystem = require("./inSystem.js")
}


basicWeapon = class extends inSystem {
    constructor(buildInfo, source) {
	super(...arguments);
	this.buildInfo = buildInfo;
	this.destroyed = false;
	this.fireWithoutTarget = true;
	this._firing = false;
	this.ready = false;
	this.source = source
	this.fireTimeout = undefined;
	this.doBurstFire = false;
	this.random = Math.random; // Temporary until there is a seeded rng
	if (typeof(buildInfo) !== 'undefined') {
	    this.name = buildInfo.name;
	    this.meta = buildInfo.meta;
	    this.count = buildInfo.count || 1
	    this.UUID = buildInfo.UUID;
	    this.reloadMilliseconds = (this.meta.properties.reload * 1000/30 / this.count) || 1000/60;
	    if ( (typeof(this.meta.properties.burstCount) !== 'undefined') &&
		 (typeof(this.meta.properties.burstReload) !== 'undefined') ) {
		this.doBurstFire = true;
		this.burstCount = 0;
		this.burstReloadMilliseconds = this.meta.properties.burstReload * 1000/30;
		this.reloadMilliseconds = (this.meta.properties.reload * 1000/30) || 1000/60;
	    }
	}
    }

    _addToSystem(sys) {
        this.system.multiplayer[this.UUID] = this;
    }

    _removeFromSystem() {
        delete this.system.multiplayer[this.UUID];
    }

    build() {
    
	// this is temporary
	// normal or pd. will be implemented eventually.
	this.meta.properties.hits = "normal";
	this.meta.properties.vulnerableTo = []; // normal and/or pd
	return this.buildProjectiles()
	    .then(_.bind(function() {
		//	    console.log(this.projectiles[0].buildInfo.convexHulls);
		this.ready = true;
		this.source.weapons.all.push(this);
		//	    console.log(this);
		if (typeof this.UUID !== 'undefined') {
		    //		this.system.built.multiplayer[this.UUID] = this;
		}
	    }, this));
    }


    buildProjectiles() {

	this.projectiles = [];
	var burstModifier = 1;
	var durationMilliseconds = this.meta.physics.duration * 1000/30;
	if (this.doBurstFire) {
	    burstModifier = ( ((this.reloadMilliseconds) * this.meta.properties.burstCount) /
			      this.meta.properties.burstReload * 1000/30);
	    if (burstModifier > 1) {burstModifier = 1}
	}
	
	// as many projectiles as can be in the air at once as a result of the weapon's
	// duration and reload times. if reload == 0, then it's one nova tick (1/30 sec)
	
	var required_projectiles = burstModifier * this.count * (Math.floor(durationMilliseconds / 
									    (this.reloadMilliseconds)) + 1);
	
	var meta = {} // for the projectiles
	meta.imageAssetsFiles = this.meta.imageAssetsFiles;
	meta.physics = this.meta.physics;
	meta.properties = this.meta.properties;
	//console.log(meta)
	var buildInfo = {
	    "meta":meta,
	    "name":this.name,
	    "source":this.source
	    
	};
	/*
	  if (this.buildInfo.hasOwnProperty('convexHulls')) {
	  buildInfo.convexHulls = this.buildInfo.convexHulls;
	  }
	*/
	//    var buildInfo = this.buildInfo;  
	for (var i=0; i < required_projectiles; i++) {
	    var proj;
	    switch (this.meta.physics.type) {
	    case undefined:
		proj = new projectile(buildInfo, this.source.system);
		break;
	    case "unguided":
		proj = new projectile(buildInfo, this.source.system);
		break;
	    case "guided":
		proj = new guided(buildInfo, this.source.system);
		break;
	    case "turret":
		proj = new projectile(buildInfo, this.source.system);
	    case "front quadrant":
		proj = new projectile(buildInfo, this.source.system);
	    }
	    this.projectiles.push(proj);
	}
	
	return Promise.all(_.map( this.projectiles, function(projectile) {return projectile.build()} ));
	
    }


    fire(direction, position, velocity) {
	// finds an available projectile and fires it
	for (var i=0; i < this.projectiles.length; i++) {
	    var proj = this.projectiles[i];
	    if (proj.available) {
		var direction = direction || this.source.pointing +
		    ((this.random() - 0.5) * 2 * this.meta.properties.accuracy) *
		    (2 * Math.PI / 360);
		var position = position || this.source.position;
		var velocity = velocity || this.source.velocity;
		proj.fire(direction, position, velocity, this.target)
		
		return true
	    }
	    
	}
	console.log("No projectile available");
	return false
    }

    notifyServer(proj, index) {
	
	var newStats = this.getStats();
	var with_uuid = {};
	with_uuid[this.UUID] = newStats;
	this.socket.emit('updateStats', with_uuid);
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
	    this.notifyServer();
	}
	
    }

    stopFiring(notify = true) {
	// low level. Stops firing
	this.doAutoFire = false;
	if (notify && (typeof this.UUID !== 'undefined')) {
	    this.notifyServer();
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
		if (this.burstCount < this.count * this.meta.properties.burstCount - 1) {
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
	    return
	}
	
	this.firing = false;
	_.each(this.projectiles, function(proj) {
	    proj.destroy();
	});
	this.destroyed = true;
    }
}
if (typeof(module) !== 'undefined') {
    module.exports = basicWeapon;
}
