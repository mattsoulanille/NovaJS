if (typeof(module) !== 'undefined') {
    module.exports = projectile;
    var acceleratable = require("../server/acceleratableServer.js");
    var _ = require("underscore");
    var Promise = require("bluebird");
    
}


function projectile(buildInfo) {
    // projectile != weapon since weapon will include beams and bays (launched ships)
    // one single projectile. Usually created en masse by a weapon.

    if (typeof(buildInfo) !== 'undefined') {
	this.meta = buildInfo.meta;
	this.source = buildInfo.source;
	this.system = this.source.system;
	acceleratable.call(this, buildInfo, this.source.system);
    }
    this.url = 'objects/projectiles/';
    this.pointing = 0;
    this.available = false;
    this.target;
}

projectile.prototype = new acceleratable;

projectile.prototype.build = function() {

    this.targets = this.system.ships; // Temporary (PD weapons can hit missiles)
    var setAvailable = function() {
	this.available = true
    }

    return acceleratable.prototype.build.call(this)
	.then(acceleratable.prototype.makeHitbox.bind(this))
	.then(_.bind(setAvailable, this));

}


projectile.prototype.loadResources = function() {
    // would set this.meta.physics, but
    // this.meta.physics is given by weapon on construction.
    // so needed a dummy promise for spaceObject.
    return new Promise(function(fulfill, reject) {
	fulfill();
    });
}

projectile.prototype.updateStats = function(stats) {
    acceleratable.prototype.updateStats.call(this, stats);
    if (typeof(stats.endTime) !== 'undefined') {
	this.endTime = stats.endTime
    }


    this.target = this.system.multiplayer[stats.target];


}

projectile.prototype.getStats = function() {
    var stats = acceleratable.prototype.getStats.call(this);
    if (typeof this.target !== "undefined") {
	stats.target = this.target.UUID;
    }
    stats.lastTime = this.lastTime
    stats.endTime = this.endTime;
    return stats;
}

projectile.prototype.render = function() {
    if (this.endTime <= this.time) {
	this.end()
    }
    acceleratable.prototype.render.call(this);
    var collisions = this.detectCollisions(this.system.built.collidables);
    
    if ((collisions.length > 1) ||
	((collisions.length == 1) && (collisions[0] != this.source)) ) {

	this.end()
//	clearTimeout(this.fireTimeout)
	
	_.each(collisions, function(collision) {
	    if (collision != this.source) {
		this.collide(collision);
	    }
	}, this);

    }

}

projectile.prototype.collide = function(other) {
    var collision = {};
    collision.shieldDamage = this.meta.properties.shieldDamage;
    collision.armorDamage = this.meta.properties.armorDamage;
    collision.impact = this.meta.properties.impact;
    collision.angle = this.pointing;
    other.receiveCollision(collision);
    
}




projectile.prototype.fire = function(direction, position, velocity, target) {
    // temporary. Gun points will be implemented later
    // maybe pass the ship to the projectile... or not
    // inaccuracy is handled by weapon
    this.target = target;
    this.endTime = this.time + this.meta.physics.duration * 1000/30;
//    this.fireTimeout = setTimeout(_.bind(this.end, this), this.meta.physics.duration * 1000/30);
    this.available = false;
    this.pointing = direction;
    this.position = _.map(position, function(x) {return x});

    // nova speeds for weapons is in pixels / frame * 100. 3/10 pixels / ms
    var factor = 3/10;

    // update the projectile's sprite's properties with the new ones
    // Placed before this.velocity... to reset this.lastTime
    this.lastTime = this.time;
//    this.render(); 
    this.velocity = [Math.cos(direction) * this.meta.physics.speed * factor + velocity[0],
		     Math.sin(direction) * this.meta.physics.speed * factor + velocity[1]];
    

    this.show();


    
//    this.
}

projectile.prototype.end = function() {
    this.velocity = [0,0];
    this.hide();
    this.available = true;

}


