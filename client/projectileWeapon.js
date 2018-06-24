if (typeof(module) !== 'undefined') {
    var _ = require("underscore");
    var Promise = require("bluebird");
    var projectile = require("../server/projectileServer.js");
    var guided = require("../server/guidedServer.js");
    var inSystem = require("./inSystem.js");
    var loadsResources = require("./loadsResources.js");
    var multiplayer = require("../server/multiplayerServer.js");
    var basicWeapon = require("../server/basicWeaponServer.js");
    var factoryQueue = require("../libraries/factoryQueue.js");
}


projectileWeapon = class extends basicWeapon {
    constructor(buildInfo, source) {
	super(...arguments);
	this.fireWithoutTarget = true;
	this.type = "weapons";
	this.projectileQueue = new factoryQueue(this.buildProjectile.bind(this));
	this.nextFireTime = 1; // next possible time the weapon can be fired
	// start at 1 because of renderable.setRendering
	this.fireTimeout = null;
	//this._justStarted = true;
    }

    
    _addToSystem(sys) {
	this.system.multiplayer[this.UUID] = this;
    }

    _removeFromSystem() {
	delete this.system.multiplayer[this.UUID];
    }

    async _build() {
	await super._build();
    }


    async buildProjectile(enqueue) {
	var proj;
	//console.log(this.source.system);
	var args = [this.buildInfo, this.source.system, this.source,
		    this.meta, this.properties, enqueue];
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
	//this.projectiles.push(proj);
	await proj.build();
	this.addChild(proj);
	return proj;
    }
    
    addInaccuracy(angle) {
	return angle +
	    ((this.random() - 0.5) * 2 * this.properties.accuracy) *
	    (2 * Math.PI / 360);	
    }

    async fireProjectile(direction, position, velocity) {
	var proj = await this.projectileQueue.dequeue();
	direction = direction || this.addInaccuracy(this.source.pointing);

	position = position || this.source.position;
	velocity = velocity || this.source.velocity;
	return proj.fire(direction, position, velocity, this.target);
		
    }
    
    fire(direction, position, velocity) {
	// finds an available projectile and fires it

	// if no position specified, default to the next exitPoint's position
	if (! position) {
	    position = this.exitPoints[this.exitIndex].position;
	    this.exitIndex = (this.exitIndex + 1) % this.exitPoints.length;
	}
	this.fireProjectile(direction, position, velocity);

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
	// if (! this.fireTimeout) {
	//     this._autoFireFunc();
	// }
//	this._justStarted = true;
	if (notify && (typeof this.UUID !== 'undefined')) {
	    this.sendStats();
	}
	if (this.system) {
	    this.show();
	}
    }

    stopFiring(notify = true) {
	// low level. Stops firing
	if (notify && (typeof this.UUID !== 'undefined')) {
	    this.sendStats();
	}
	if (this.system) {
	    this.hide();
	}
    }
    // _autoFireFunc() {
    // 	if (this.canFire()) {
    // 	    this.fire();
    // 	}

    // }
    
    
    render() {
	super.render(...arguments);

	// if it's rendering, then it's firing.
	//this.lastFireTime = this.time;
	if (this.canFire() && (this.time >= this.nextFireTime)) {

	    if (this.doBurstFire) {
		if (this.burstCount < this.count * this.properties.burstCount) {
		    if (this.fireSimultaneously) {
			this.burstCount += this.count;
		    }
		    else {
			this.burstCount ++;
		    }
		}
		else {
		    this.burstCount = 0;
		    this.nextFireTime += this.burstReloadMilliseconds;
		    return; // since it burst reloaded
		}
	    }
	    // Maybe move this to the fire function?
	    if (this.fireSimultaneously) {
		for (var i = 0; i < this.count; i++) {
		    this.fire();
		}
	    }
	    else {
		this.fire();
	    }
	    this.nextFireTime = this.time + this.reloadMilliseconds;

	}
    }
    
    destroy() {
	if (this.destroyed) {
	    return;
	}

	// watch out. this sends stuff over socket.io
	// wait no it doesn't. I think. 
	this._firing = false;
	super.destroy();

	this.buildProjectile = function() {
	    throw new Error("Called method of destroyed object");
	};

	this.projectileQueue.destroy(); // destroys all projectiles
    }
}
if (typeof(module) !== 'undefined') {
    module.exports = projectileWeapon;
}
