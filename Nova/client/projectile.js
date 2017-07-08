if (typeof(module) !== 'undefined') {
    var acceleratable = require("../server/acceleratableServer.js");
    var turnable = require("../server/turnableServer.js");
    var damageable = require("../server/damageableServer.js");
    var collidable = require("../server/collidableServer.js");
    var movable = require("../server/movableServer.js");
    var spaceObject = require("../server/spaceObjectServer.js");
    var _ = require("underscore");
    var Promise = require("bluebird");
}


projectile = class extends acceleratable(turnable(damageable(collidable(movable(spaceObject))))) {
    // projectile != weapon since weapon will include beams and bays (launched ships)
    // one single projectile. Usually created en masse by a weapon.
    constructor(buildInfo, system) {
	super(buildInfo, system);

	if (typeof(buildInfo) !== 'undefined') {
	    this.meta = buildInfo.meta;
	    this.source = buildInfo.source;
	}
	this.url = 'objects/projectiles/';
	this.pointing = 0;
	this.available = false;
	this.target;
    }

    async build() {
	await super.build();
	this.available = true;
    }
    

    _addToSystem() {
	this.targets = this.system.ships; // Temporary (PD weapons can hit missiles)
        super._addToSystem.call(this);
    }

    _removeFromSystem() {
	this.targets = new Set();
        super._removeFromSystem.call(this);
    }
    
    loadResources() {
	// would set this.meta.physics, but
	// this.meta.physics is given by weapon on construction.
	// so needed a dummy promise for spaceObject.
	// Do I really tho?
	return new Promise(function(fulfill, reject) {
	    fulfill();
	});
    }

    updateStats(stats) {
	    super.updateStats.call(this, stats);
	// if (typeof(stats.endTime) !== 'undefined') {
	// 	this.endTime = stats.endTime
	// }
	
	this.target = this.system.multiplayer[stats.target];
    }
    
    getStats() {
	var stats = super.getStats.call(this);
	if (typeof this.target !== "undefined") {
	    stats.target = this.target.UUID;
	}
	stats.lastTime = this.lastTime
	stats.endTime = this.endTime;
	return stats;
    }

    render() {

	// if (this.endTime <= this.time) {
	// 	this.end()
	// }
	
	super.render.call(this);
	
	/*
	  var collisions = this.detectCollisions(this.system.built.collidables);
	  
	  if ((collisions.length > 1) ||
	  ((collisions.length == 1) && (collisions[0] != this.source)) ) {
	  
	  clearTimeout(this.endTimeout);
	  this.end();
	  
	  
	  _.each(collisions, function(collision) {
	  if (collision != this.source) {
	  this.collide(collision);
	  }
	  }, this);
	  
	  }
	*/
    }

    collideWith(other) {
	// temporary. will have damage types later
	if (other.properties.vulnerableTo &&
	    other.properties.vulnerableTo.includes("normal") &&
	    other !== this.source) {
	    var collision = {};
	    collision.shieldDamage = this.meta.properties.shieldDamage;
	    collision.armorDamage = this.meta.properties.armorDamage;
	    collision.impact = this.meta.properties.impact;
	    collision.angle = this.pointing;
	    //console.log("Projectile hit something");
	    other.receiveCollision(collision);
	    this.end();
	    clearTimeout(this.endTimeout);
	}
    
    }


    fire(direction, position, velocity, target) {
	// temporary. Gun points will be implemented later
	// maybe pass the ship to the projectile... or not
	// inaccuracy is handled by weapon
	this.target = target;
	this.endTime = this.time + this.meta.physics.duration * 1000/30;
	this.endTimeout = setTimeout(this.end.bind(this), this.meta.physics.duration * 1000/30);
	
	this.available = false;
	this.pointing = direction;
	this.position = _.map(position, function(x) {return x});

	// nova speeds for weapons is in pixels / frame * 100. 3/10 pixels / ms
	//    var factor = 3/10;
	
	// update the projectile's sprite's properties with the new ones
	// Placed before this.velocity... to reset this.lastTime
	this.lastTime = this.time;
	//    this.render(); 
	this.velocity = [Math.cos(direction) * this.meta.physics.speed * this.factor  + velocity[0],
			 Math.sin(direction) * this.meta.physics.speed * this.factor  + velocity[1]];
	
	this.show();
    }
    
    end() {
	this.velocity = [0,0];
	this.hide();
	this.available = true;
    }
}


if (typeof(module) !== 'undefined') {
    module.exports = projectile;
}
