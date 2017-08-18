if (typeof(module) !== 'undefined') {
//    var _ = require("underscore");
    //    var Promise = require("bluebird");
    var collidable = require("../server/collidableServer");
    var inSystem = require("./inSystem.js");
    var PIXI = require("../server/pixistub.js");
    var multiplayer = require("../server/multiplayerServer.js");
    var loadsResources = require("./loadsResources");
}

// rewrite
// and refactor with basicWeapon
beamWeapon = class extends collidable(loadsResources(inSystem)){

    constructor(buildInfo, source) {
	super(...arguments);
	this.type = "weapons";
	this.socket = source.socket;
	this.container = new PIXI.Container();
	this.buildInfo = buildInfo;
	this._firing = false;
	this.doAutoFire = false;
	this.ready = false;
	this.source = source;
	this.rendering = false;
	this.built = false;
	this.visible = false;
	if (typeof source !== 'undefined') {
	    this.position = source.position;
	}
	if (typeof(buildInfo) !== 'undefined') {
	    this.id = buildInfo.id;
	    this.UUID = buildInfo.UUID;
	    this.multiplayer = new multiplayer(this.socket, this.UUID);
	}
    }

/*
Ray intersect convex hull algorithm (not yet implemented):

If there are points of the convex hull on both sides of the ray extended to infinity:
    
    For all pairs of points that are sequental and for which 
    one is on one side and the other is on the other side of the ray:

        If both points of the pair are closer to beam source than length of beam (radius):
	    
	    There is an intersection. Line segment intersects line segment linear algebra...

	elif one point of the pair is closer to beam source than length of beam (radius):

	    There may be an intersection. Line segment intersects line segment linear algebra...
	
	else:
	
	    No intersection

    If intersection, return closest intersection for pairs mentioned before
    Else, return false
Else, return false
*/


    async build() {
	
	this.meta = await this.loadResources(this.type, this.buildInfo.id);
	this.setProperties();
	this.graphics = new PIXI.Graphics();

	this.container.addChild(this.graphics);

	this.source.weapons.all.push(this);

	this.ready = true;
	this.built = true;
	
	if (typeof(this.system) !== 'undefined') {
	    this._addToSystem();
	}
	this.multiplayer.on('updateStats', this.updateStats.bind(this));

    };

    buildConvexHulls() {
	var length = this.meta.animation.beamLength;
	var halfWidth = this.meta.animation.beamWidth / 2;
	var collisionPoints = [new this.crash.V(0, halfWidth),
			       new this.crash.V(0, -halfWidth),
			       new this.crash.V(length, -halfWidth),
			       new this.crash.V(length, halfWidth)
			      ];
	this.collisionShape = new this.crash.Polygon(new this.crash.V, collisionPoints, false, this);
    }

    set firing(val) {

	if (val) {
	    this._firing = true;
	    this.startFiring();
	}
	else {
	    this._firing = false;
	    this.stopFiring();
	}
    }

    get firing() {
	return this._firing;
    }
    
    startFiring(notify = true) {
	this.graphics.visible = true;
	this.rendering = true;
	this.visible = true;
	if ( !(this.crash.all().includes(this.collisionShape)) ) {
	    this.collisionShape.insert();
	}
	if ((typeof this.UUID !== 'undefined') && notify) {
	    this.sendStats();
	}
    }

    stopFiring(notify = true) {
	this.graphics.clear();
	this.graphics.visible = false;
	this.rendering = false;
	this.visible = false;
	this.collisionShape.remove();
	if ((typeof this.UUID !== 'undefined') && notify) {
	    this.sendStats();
	}
    }

    show() {
	// necessary for inheritance
	// wait. is it really necessary anymore?
    }
    
    getStats() {
	var stats = {};
	stats.firing = this.firing;
	return stats;
    }

    updateStats(stats) {
	if (typeof stats.firing !== 'undefined') {
	    if (stats.firing) {
		this.startFiring(false);
		this._firing = true;
	    }
	    else {
		this.stopFiring(false);
		this._firing = false;
	    }
	}
    }


    sendStats() {
	this.multiplayer.emit('updateStats', this.getStats());
    }
    
    render(fireAngle = this.source.pointing) {
	if (this.firing) {
	    this.graphics.position.x = this.position[0];
	    //(this.position[0] - stagePosition[0]) + (screenW-194)/2;
	    this.graphics.position.y = -1 * this.position[1];
		//(this.position[1] - stagePosition[1]) + screenH/2;
	    this.graphics.clear();
	    this.graphics.lineStyle(this.meta.animation.beamWidth, this.meta.animation.beamColor);
	    this.graphics.moveTo(0,0); // Position of the beam is handled by moving the PIXI graphics
	    var x = Math.cos(fireAngle) * this.meta.animation.beamLength;
	    var y = -Math.sin(fireAngle) * this.meta.animation.beamLength;
	    this.graphics.lineTo(x,y);

	    this.renderCollisionShape(fireAngle);
	}
    }


    renderCollisionShape(fireAngle = this.source.pointing) {
	this.collisionShape.moveTo(...this.position);
	this.collisionShape.setAngle(fireAngle);
    }


    collideWith(other, res) {
	//console.log(res);
	var delta = (other.delta) * 60 / 1000;

	if (other.properties.vulnerableTo &&
	    other.properties.vulnerableTo.includes("normal") &&
	    other !== this.source) {

	    var collision = {};
	    collision.shieldDamage = this.properties.shieldDamage * delta;
	    collision.armorDamage = this.properties.armorDamage * delta;
	    // needs improvement for proper tractoring
	    //collision.impact = this.properties.impact * delta;
	    collision.angle = this.pointing;
	    
	    //console.log(collision);
	    other.receiveCollision(collision);
	}
    }

    receiveCollision(collision) { // maybe do beam clipping here?
    }

    _removeFromSystem() {
	this.system.container.removeChild(this.container);
	if (this.UUID && this.system.multiplayer[this.UUID]) {
	    delete this.system.multiplayer[this.UUID];
	}

	this.system.built.render.delete(this);
	super._removeFromSystem.call(this);
	
	
    }
    _addToSystem() {
	this.system.container.addChild(this.container);
	if (this.UUID) {
	    this.system.multiplayer[this.UUID] = this;
	}

	if (this.built) {
	    this.system.built.render.add(this);
	}

	this.system.spaceObjects.add(this);
	super._addToSystem.call(this);
    }
    
    
    destroy() {
	this._firing = false;
	this.stopFiring(false);
	this.multiplayer.destroy();
	this.container.destroy();

    }

    setTarget(target) {
	this.target = target;
    }
}

    
if (typeof(module) !== 'undefined') {
    module.exports = beamWeapon;
}

    
