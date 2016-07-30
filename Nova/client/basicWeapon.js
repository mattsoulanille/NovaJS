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

    if (typeof(buildInfo) !== 'undefined') {
	this.name = buildInfo.name;
	this.meta = buildInfo.meta;
	this.system = this.source.system;
	this.count = buildInfo.count || 1
	this.UUID = buildInfo.UUID;
	if (typeof this.UUID !== 'undefined') {
	    this.system.multiplayer[this.UUID] = this;
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
    // as many projectiles as can be in the air at once as a result of the weapon's
    // duration and reload times
    var required_projectiles = this.count * (Math.floor(this.meta.physics.duration /
							this.meta.properties.reload) + 1);
    var meta = {} // for the projectiles
    meta.imageAssetsFiles = this.meta.imageAssetsFiles;
    meta.physics = this.meta.physics;
    meta.properties = this.meta.properties
    //console.log(meta)
    var buildInfo = {
	"meta":meta,
	"name":this.name,
	"source":this.source
    };

    
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

    return Promise.all(_.map( this.projectiles, function(projectile) {projectile.build()} ));

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
    return false
}

basicWeapon.prototype.notifyServer = function(proj, index) {
    // this.socket is defined in nova.js
    var newStats = {};
    //    newStats[index] = this.projectiles[index].getStats();
    newStats.doAutoFire = this.doAutoFire;
    var with_uuid = {};
    with_uuid[this.UUID] = newStats;
    this.socket.emit('updateStats', with_uuid);
}

basicWeapon.prototype.getStats = function() {
    var stats;
    // stats = _.map(this.projectiles, function(proj) {
    // 	return proj.getStats();
    // });
    stats.doAutoFire = this.doAutoFire;
    return stats;
}

basicWeapon.prototype.updateStats = function(stats) {
    // _.each(statsList, function(stats, index) {
    // 	this.projectiles[index].updateStats(stats);
    // }.bind(this));
    if (stats.doAutoFire === true) {
	if (this.firing) {
	    this.doAutoFire = true
	    
	}
	else {
	    this.doAutoFire = true
	    this.autoFire()
	}
    }
    else {
	this.doAutoFire = false
    }
}

basicWeapon.prototype.startFiring = function() {
    if (this.firing) {
	this.doAutoFire = true

    }
    else {
	this.doAutoFire = true
	this.autoFire()
    }
    if (typeof this.UUID !== 'undefined') {
	this.notifyServer();
    }


}

basicWeapon.prototype.stopFiring = function() {
    this.doAutoFire = false
    if (typeof this.UUID !== 'undefined') {
	this.notifyServer();
    }

}

basicWeapon.prototype.autoFire = function() {
    if (this.doAutoFire) {
	this.firing = true
	
	// fire
	this.fire()
	
	// fire again after reload time
	var reloadTimeMilliseconds = this.meta.properties.reload * 1000/30 / this.count;
	setTimeout(_.bind(this.autoFire, this), reloadTimeMilliseconds)
    }
    else {
	this.firing = false
    }
}

basicWeapon.prototype.cycleTarget = function(target) {
    this.target = target;
}

basicWeapon.prototype.destroy = function() {
    _.each(this.projectiles, function(proj) {
	proj.destroy()
    });
}
