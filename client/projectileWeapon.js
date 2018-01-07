if (typeof(module) !== 'undefined') {
    var _ = require("underscore");
    var Promise = require("bluebird");
    var projectile = require("../server/projectileServer.js");
    var guided = require("../server/guidedServer.js");
    var inSystem = require("./inSystem.js");
    var loadsResources = require("./loadsResources.js");
    var multiplayer = require("../server/multiplayerServer.js");
    var basicWeapon = require("../server/basicWeaponServer.js");
}


projectileWeapon = class extends basicWeapon {
    constructor(buildInfo, source) {
	super(...arguments);
	this.fireWithoutTarget = true;
	this.fireTimeout = undefined;
	this.type = "weapons";
	this.projectiles = [];
    }

    
    _addToSystem(sys) {
        this.system.multiplayer[this.UUID] = this;
    }

    _removeFromSystem() {
        delete this.system.multiplayer[this.UUID];
    }

    async _build() {
	await super._build.call(this);
	await this.buildProjectiles();
    }


    async getProjectileCount() {
	var testProj;
	if (this.projectiles.length === 0) {
	    testProj = this.buildProjectile();
	    await testProj.build();
	}
	else {
	    testProj = this.projectiles[0];
	}

	
	var burstModifier = 1; // modifier to calculate how many projectiles needed
	//var particleDuration = Math.max(this.properties.trailParticles.lifeMax,
	//					    this.properties.hitParticles.life);
	
	//var durationMilliseconds = (this.properties.duration + particleDuration) * 1000/30;

	var durationMilliseconds = testProj.lifetime;
	if (this.doBurstFire) {
	    burstModifier = ( ((this.reloadMilliseconds) * this.properties.burstCount) /
			      this.properties.burstReload * 1000/30);
	    if (burstModifier > 1) {burstModifier = 1;}
	}
	
	// as many projectiles as can be in the air at once as a result of the weapon's
	// duration and reload times. if reload == 0, then it's one nova tick (1/30 sec)

	// Maximum is 60 projectiles fired per second (1000/60 milliseconds/projectile)
	this.reloadMilliseconds = Math.max(this.reloadMilliseconds, 1000/60);
	
	return burstModifier * this.count * Math.ceil(durationMilliseconds / this.reloadMilliseconds);

    }

    buildProjectile() {
	var proj;
	//console.log(this.source.system);
	var args = [this.buildInfo, this.source.system, this.source];
	switch (this.properties.type) {
	case "unguided":
	    proj = new projectile(...args);
	    break;
	case "guided":
	    proj = new guided(...args);
	    break;
	case "turret":
	    proj = new projectile(...args);
	    break;
	case "front quadrant":
	    proj = new projectile(...args);
	    break;
	default:
	    // temp
	    proj = new projectile(...args);
	    break;
	}
	this.projectiles.push(proj);
	this.addChild(proj);
	return proj;
    }
    
    async buildProjectiles() {

	var required_projectiles = await this.getProjectileCount();

	//    var buildInfo = this.buildInfo;  
	for (var i=this.projectiles.length; i < required_projectiles; i++) {
	    this.buildProjectile();
	}
	
	await Promise.all(_.map( this.projectiles, function(projectile) {return projectile.build()} ));
	
    }


    fire(direction, position, velocity) {
	// finds an available projectile and fires it

	// if no position specified, default to the next exitPoint's position
	if (! position) {
	    position = this.exitPoints[this.exitIndex].position;
	    this.exitIndex = (this.exitIndex + 1) % this.exitPoints.length;
	}

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
    module.exports = projectileWeapon;
}
