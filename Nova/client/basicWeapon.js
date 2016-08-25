if (typeof(module) !== 'undefined') {
    module.exports = basicWeapon;
    var _ = require("underscore");
    var Promise = require("bluebird");
    var projectile = require("../server/projectileServer.js");
    var guided = require("../server/guidedServer.js");
}


function basicWeapon(buildInfo, source) {
    this.buildInfo = buildInfo;
    this.firing = false;
    this.doAutoFire = false;
    this.ready = false;
    this.source = source
    this.fireTimeout = undefined;
    this.doBurstFire = false;
    if (typeof(buildInfo) !== 'undefined') {
	this.name = buildInfo.name;
	this.meta = buildInfo.meta;
	this.system = this.source.system;
	this.count = buildInfo.count || 1
	this.UUID = buildInfo.UUID;
	this.reloadMilliseconds = (this.meta.properties.reload * 1000/30 / this.count) || 1000/60;
	if (typeof this.UUID !== 'undefined') {
	    this.system.multiplayer[this.UUID] = this;
	}
	if ( (typeof(this.meta.properties.burstCount) !== 'undefined') &&
	     (typeof(this.meta.properties.burstReload) !== 'undefined') ) {
	    this.doBurstFire = true;
	    this.burstCount = 0;
	    this.burstReloadMilliseconds = this.meta.properties.burstReload * 1000/30;
	    this.reloadMilliseconds = (this.meta.properties.reload * 1000/30) || 1000/60;
	}
    }
}

basicWeapon.prototype.build = function() {

    
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


basicWeapon.prototype.buildProjectiles = function() {

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
    for (i=0; i < required_projectiles; i++) {
	var proj;
	switch (this.meta.physics.type) {
	case undefined:
	    proj = new projectile(buildInfo);
	    break;
	case "unguided":
	    proj = new projectile(buildInfo);
	    break;
	case "guided":
	    proj = new guided(buildInfo);
	    break;
	case "turret":
	    proj = new projectile(buildInfo);
	case "front quadrant":
	    proj = new projectile(buildInfo);
	}
	this.projectiles.push(proj);
    }

    return Promise.all(_.map( this.projectiles, function(projectile) {return projectile.build()} ));

}


basicWeapon.prototype.fire = function(direction, position, velocity) {
    // finds an available projectile and fires it
    for (i=0; i < this.projectiles.length; i++) {
	var proj = this.projectiles[i];
	if (proj.available) {
	    var direction = direction || this.source.pointing +
		((Math.random() - 0.5) * 2 * this.meta.properties.accuracy) *
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

basicWeapon.prototype.notifyServer = function(proj, index) {

    var newStats = this.getStats();
    var with_uuid = {};
    with_uuid[this.UUID] = newStats;
    this.socket.emit('updateStats', with_uuid);
}

basicWeapon.prototype.getStats = function() {
    var stats = {};
    stats.doAutoFire = this.doAutoFire;
    return stats;
}

basicWeapon.prototype.updateStats = function(stats) {
    // _.each(statsList, function(stats, index) {
    // 	this.projectiles[index].updateStats(stats);
    // }.bind(this));
    if (stats.doAutoFire === true) {
	this.startFiring(false);
    }
    else {
	this.stopFiring(false);
    }
}

basicWeapon.prototype.startFiring = function(notify = true) {
    if (this.firing) {
	this.doAutoFire = true

    }
    else {
	this.doAutoFire = true
	this.autoFire()
    }
    if (notify && (typeof this.UUID !== 'undefined')) {
	this.notifyServer();
    }

}

basicWeapon.prototype.stopFiring = function(notify = true) {
    this.doAutoFire = false
    if (notify && (typeof this.UUID !== 'undefined')) {
	this.notifyServer();
    }

}

basicWeapon.prototype.autoFire = function() {
    if (this.doAutoFire) {
	this.firing = true;
	
	// fire
	this.fire();
	
	// fire again after reload time
	if (this.doBurstFire) {
	    if (this.burstCount < this.count * this.meta.properties.burstCount - 1) {
		this.fireTimeout = setTimeout(_.bind(this.autoFire, this), this.reloadMilliseconds);
		this.burstCount ++;
	    }
	    else {
		this.burstCount = 0;
		this.burstTimeout = setTimeout(this.autoFire.bind(this), this.burstReloadMilliseconds);
	    }
	}
	else {
	    this.fireTimeout = setTimeout(_.bind(this.autoFire, this), this.reloadMilliseconds);
	}
    }
    else {
	this.firing = false;
    }
}

basicWeapon.prototype.cycleTarget = function(target) {
    this.target = target;
}

basicWeapon.prototype.destroy = function() {
    this.stopFiring();
    _.each(this.projectiles, function(proj) {
	proj.destroy();
    });
}
