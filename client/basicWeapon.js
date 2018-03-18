if (typeof(module) !== 'undefined') {
    var _ = require("underscore");
    var Promise = require("bluebird");
    var projectile = require("../server/projectileServer.js");
    var guided = require("../server/guidedServer.js");
    var inSystem = require("./inSystem.js");
    var loadsResources = require("./loadsResources.js");
    var multiplayer = require("../server/multiplayerServer.js");
    var renderable = require("./renderable.js");
    var eventable = require("../libraries/eventable.js");
}




basicWeapon = class extends eventable(renderable(loadsResources(inSystem))) {
    constructor(buildInfo, source) {
	super(...arguments);
	this.socket = source.socket; // necessary for server
	this.buildInfo = buildInfo;
	this.destroyed = false;
	this.fireWithoutTarget = true;
	this._firing = false;
	this.ready = false;
	this.built = false;
	this.source = source;
	this.doAutoFire = false; // low level
	this.fireTimeout = undefined;
	this.doBurstFire = false;
	this.exitIndex = 0; // index of exitPoint array
	this.random = Math.random; // Temporary until there is a seeded rng
	this.enabled = true; // whether or not the weapon can fire. Used when landing etc.

	if (typeof(buildInfo) !== 'undefined') {
	    this.id = buildInfo.id;
	    this.count = buildInfo.count || 1;
	    this.UUID = buildInfo.UUID;
	    if (this.UUID) {
		this.multiplayer = new multiplayer(this.socket, this.UUID);
	    }
	}
	if (typeof source !== 'undefined') {
	    this.system = source.system;
	}

	this.type = "weapons";

    }

    setTarget(target) {
	this.target = target;
	if (this.target) {
	    this._setState("hasTarget", true);
	}
	else {
	    this._setState("hasTarget", false);
	}	
    }

    
    makeContainer() {} // for beamWeapon. A workaround. Not pretty but simple.
    
    async _build() {
	this.meta = await this.loadResources(this.type, this.buildInfo.id);

	// assign exitPoints
	if (this.meta.exitType in this.source.exitPoints) {
	    this.exitPoints = this.source.exitPoints[this.meta.exitType];
	}
	else {
	    this.exitPoints = this.source.exitPoints['center'];
	}

	this.setProperties();
	var normalDamageTypes = [
	    "unguided",
	    "turret",
	    "guided",
	    "freefall bomb",
	    "rocket",
	    "front quadrant",
	    "rear quadrant",
	    "beam",
	    "beam turret"
	];

	var pdDamageTypes = [
	    "point defense",
	    "point defense beam"
	];

	this.properties.damageType = null;
	if (normalDamageTypes.includes(this.properties.type)) {
	    this.properties.damageType = "normal";
	}
	else if (pdDamageTypes.includes(this.properties.type)) {
	    this.properties.damageType = "point defense";
	}

	
	this.fireSimultaneously = Boolean(this.meta.fireSimultaneously);


	this.reloadMilliseconds = (this.properties.reload * 1000/30 / this.count) || 1000/60;
	if ( this.properties.burstCount > 0 ) {
	    this.doBurstFire = true;
	    this.burstCount = 0;
	    this.burstReloadMilliseconds = this.properties.burstReload * 1000/30;
	}

	if (this.fireSimultaneously) {
	    this.reloadMilliseconds = this.properties.reload * 1000 / 30 || 1000 / 60;
	}


	
	
    }

    // remove this
    // get system() {
    // 	return this.source.system;
    // }

    // set system(s) {
    // 	// If you're looking for things to make more sane, look here.
    // 	//throw new Error("Tried to set system of a weapon, but it's just the system of what has the weapon.");
    // }
    
    async build() {
	await this._build();

	if (typeof this.UUID !== 'undefined') {
	    this.multiplayer.on('updateStats', this.updateStats.bind(this));
	}
	
	this.ready = true;
	this.built = true;
	this.source.weapons.all.push(this);
    }

    


    set firing(val) {
	// high level: Auto fires the weapon if it could fire.
	if (val && this.enabled) {
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

    updateStats(stats) {
	if (this.doBurstFire) {
	    this.burstCount = stats.burstCount;
	}
	if (stats.firing === true) {
	    this.startFiring(false);
	    this._firing = true;
	}
	else {
	    this.stopFiring(false);
	    this._firing = false;
	}
    }
    
    getStats() {
	var stats = {};
	stats.firing = this.firing;
	if (this.doBurstFire) {
	    stats.burstCount = this.burstCount;
	}
	return stats;
    }

    
    sendStats() {
	this.multiplayer.emit("updateStats", this.getStats());
    }

    
    startFiring() {}
    stopFiring() {}

};


if (typeof(module) !== 'undefined') {
    module.exports = basicWeapon;
}
