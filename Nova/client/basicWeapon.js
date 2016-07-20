if (typeof(module) !== 'undefined') {
    module.exports = basicWeapon;
    var _ = require("underscore");
    var Promise = require("bluebird");
    var projectile = require("../server/projectileServer.js");
    var guided = require("../server/guidedServer.js");
}


function basicWeapon(weaponName, source, meta, count) {
    this.name = weaponName;
    this.meta = meta;
    this.firing = false;
    this.doAutoFire = false;
    this.source = source;
    this.count = count || 1
    this.ready = false;

}

basicWeapon.prototype.build = function() {
    return this.buildProjectiles()
	.then(_.bind(function() {
	    this.ready = true
	    this.source.weapons.all.push(this)
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

    for (i=0; i < required_projectiles; i++) {
	var proj;
	switch (this.meta.physics.type) {
	case undefined:
	    proj = new projectile(this.name, meta, this.source);
	    break;
	case "unguided":
	    proj = new projectile(this.name, meta, this.source);
	    break;
	case "guided":
	    proj = new guided(this.name, meta, this.source);
	    break;
	case 'turret':
	    proj = new projectile(this.name, meta, this.source);
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


basicWeapon.prototype.startFiring = function() {
    if (this.firing) {
	this.doAutoFire = true

    }
    else {
	this.doAutoFire = true
	this.autoFire()
    }

}

basicWeapon.prototype.stopFiring = function() {
    this.doAutoFire = false
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
