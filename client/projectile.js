if (typeof(module) !== 'undefined') {
    var acceleratable = require("../server/acceleratableServer.js");
    var turnable = require("../server/turnableServer.js");
    var damageable = require("../server/damageableServer.js");
    var collidable = require("../server/collidableServer.js");
    var movable = require("../server/movableServer.js");
    var spaceObject = require("../server/spaceObjectServer.js");
    var _ = require("underscore");
    Promise = require("bluebird");
    var weaponBuilder;
    var errors = require("./errors.js");
    var AlliesError = errors.AlliesError;
}


projectile = class extends acceleratable(turnable(damageable(collidable(movable(spaceObject))))) {
    // projectile != weapon since weapon will include beams and bays (launched ships)
    // one single projectile. Usually created en masse by a weapon.
    constructor(buildInfo, system, source) {
	super(buildInfo, system);
	this.source = source;
	//console.log(this.sytem);
	this.type = "weapons"; // that's where the data is. sorry.
	this.pointing = 0;
	this.available = false;
	this.subs = [];
	this.maxSubTime = 0;
    }

    get allies() {
	return new Set([...this.source.allies, this]);
    }

    set allies(a) {
	throw new AlliesError("Tried to set allies of a projectile but they are defined implicitly by source");
    }
    
    async _build() {
	await super._build();
	await this.buildSubs();
	await this.buildExplosion();
	this.buildParticles();
	this.lifetime = this.properties.duration * 1000 / 30; // milliseconds

	// include 0 so Math.max has a min
	var additionalTimes = [0];
	
	if (this.trailParticles) {
	    additionalTimes.push(this.trailParticles.lifetime);
	}

	if (this.hitParticles) {
	    additionalTimes.push(this.hitParticles.lifetime);
	}

	if (this.explosion) {
	    additionalTimes.push(this.explosion.lifetime);
	}

	if (this.subs.length !== 0) {
	    var subDurations = this.subs.map(function(sub) {
		return sub.projectiles[0].lifetime;
	    });
	    var maxSubTime = Math.max(...subDurations);
	    additionalTimes.push(maxSubTime);
	}
	
	this.additionalTime = Math.max(...additionalTimes);
	this.lifetime += this.additionalTime;
	this.available = true;
    }

    
    async buildSubs() {
	if (!this.meta.submunitions) {
	    return;
	}

	if ( (! weaponBuilder) && (typeof(module) !== 'undefined') ) {
	    // is this insane? Um, Yes it is. Necessary to avoid some mutual recursion thing I think.
	    weaponBuilder = require("../server/weaponBuilderServer.js");
	}

	for (var i = 0; i < this.meta.submunitions.length; i++) {
	    var subData = this.meta.submunitions[i];
	    var buildInfo = {id: subData.id};
	    var sub = await new weaponBuilder(buildInfo, this).buildSub(subData);
	    if (sub) {
		this.subs.push(sub);
	    }
	}
    }
    

    buildParticles() {
	if (this.meta.trailParticles.number > 0) {
	    this.trailParticles = new particleEmitter(this.meta.trailParticles, this);
	    this.addChild(this.trailParticles);
	}

	if (this.meta.hitParticles.number > 0) {
	    this.hitParticles = new particleEmitter(this.meta.hitParticles, this);
	    this.addChild(this.hitParticles);
	}
    }

    async buildExplosion() {
	// just the graphic. Collision explosions are (going to be) handled differently
	if (this.meta.explosion) {
	    this.explosion = new explosion(this.meta.explosion);
	    await this.explosion.build();
	    this.addChild(this.explosion);
	}
	
    }
    
    setMultiplayer() {} // refactor me please
    
    // makeSprites() {
    // 	//console.log(this.meta.animation);
    // 	super.makeSprites.call(this);
    // }
    
    _addToSystem() {
	//console.log("adding proj to system");
	this.targets = this.system.ships; // Temporary (PD weapons can hit missiles)
        super._addToSystem.call(this);
    }

    _removeFromSystem() {
	//console.log("removing proj from system");
	this.targets = new Set();
        super._removeFromSystem.call(this);
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
	stats.lastTime = this.lastTime;
	stats.endTime = this.endTime;
	return stats;
    }

    collideWith(other) {
	// temporary. will have damage types later
	// this should probably be a separate mixin or class. lots of things do damage.
	if (other.properties.vulnerableTo &&
	    other.properties.vulnerableTo.includes("normal") &&
	    !this.allies.has(other)) {

	    
	    var collision = {};
	    collision.shieldDamage = this.properties.shieldDamage;
	    collision.armorDamage = this.properties.armorDamage;
	    collision.impact = this.properties.impact;
	    collision.angle = this.pointing;
	    //console.log("Projectile hit something");
	    other.receiveCollision(collision);
	    if (this.hitParticles) {
		this.hitParticles.renderHit();
	    }
	    clearTimeout(this.endTimeout);
	    this.end();
	}
    
    }

    fire(direction, position, velocity, target) {
	// temporary. Gun points will be implemented later
	// maybe pass the ship to the projectile... or not
	// inaccuracy is handled by weapon
	this.target = target;
	this.endTime = this.time + this.properties.duration * 1000/30;
	this.endTimeout = setTimeout(this.end.bind(this), this.properties.duration * 1000/30);
	
	this.available = false;
	this.pointing = direction;
	this.position = _.map(position, function(x) {return x});

	// nova speeds for weapons is in pixels / frame * 100. 3/10 pixels / ms
	//    var factor = 3/10;
	
	// update the projectile's sprite's properties with the new ones
	// Placed before this.velocity... to reset this.lastTime
	this.lastTime = this.time;
	//    this.render(); 
	this.velocity = [Math.cos(direction) * this.properties.speed * this.factor  + velocity[0],
			 Math.sin(direction) * this.properties.speed * this.factor  + velocity[1]];

	if (this.trailParticles) {
	    this.trailParticles.emit = true;
	}
	
	this.show();
    }
    
    end() {
	this.subs.forEach(function(sub) {
	    sub.fire(null, null, [0,0]); // only give velocity
	});
	
	this.target = null;
	
	this.velocity = [0,0];
	this.hide();

	if (this.explosion) {
	    this.explosion.explode(this.position);
	}

	if (this.trailParticles || this.hitParticles) {

	    if (this.trailParticles) {
		this.trailParticles.emit = false;
	    }
	    if (this.hitParticles) {
		this.hitParticles.emit = false;
	    }
	}


	setTimeout(function() {
	    this.available = true;
	}.bind(this), this.additionalTime);
    }
    render(delta) {
	super.render(...arguments);
    }
    destroy() {
	// make a parent child thing for this
	clearTimeout(this.endTimeout);
	if (this.trailParticles) {
	    this.trailParticles.destroy();
	}

	if (this.hitParticles) {
	    this.hitParticles.destroy();
	}

	super.destroy();
    }
};


if (typeof(module) !== 'undefined') {
    module.exports = projectile;
}
