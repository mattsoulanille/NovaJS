if (typeof(module) !== 'undefined') {
//    var _ = require("underscore");
    //    var Promise = require("bluebird");
    var collidable = require("../server/collidableServer");
    var inSystem = require("./inSystem.js");
    var PIXI = require("../server/pixistub.js");
    var basicWeapon = require("../server/basicWeaponServer.js");
    var renderable = require("./renderable.js");
}

// rewrite
// and refactor with basicWeapon
beamWeapon = class extends collidable(renderable(basicWeapon)) {

    constructor(buildInfo, source) {
	super(...arguments);
	this.container = new PIXI.Container();

	if (this.system) {
	    // so the inheritance chain works
	    this.system.container.addChild(this.container);
	}
	    
	//this.type = "weapons";
	//this.socket = source.socket;

	//this.buildInfo = buildInfo;
	this._rendering = false;
	this.built = false;
	if (typeof source !== 'undefined') {
	    // exitPoints go here
	    this.position = source.position;
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


    async _build() {
	await super._build.call(this);

	this.graphics = new PIXI.Graphics();
	this.container.addChild(this.graphics);

	if (this.system) {
	    this.system.built.render.add(this);
	}

	this.built = true;
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

    
    startFiring(notify = true) {
	this.graphics.visible = true;
	this._rendering = true;
	if ( !(this.crash.all().includes(this.collisionShape)) ) {
	    this.collisionShape.insert();
	}
	if ((typeof this.UUID !== 'undefined') && notify) {
	    this.sendStats();
	}

	// Control which point the beam comes from
	// This will probably need to be written so that clients are more sure about which place a beam is coming from.
	this.switchExitInterval = setInterval(function() {
	    this.exitIndex = (this.exitIndex + 1) % this.exitPoints.length;
	}.bind(this), this.reloadMilliseconds);
	
    }

    stopFiring(notify = true) {
	this.graphics.clear();
	this.graphics.visible = false;
	this._rendering = false;
	this.collisionShape.remove();
	if ((typeof this.UUID !== 'undefined') && notify) {
	    this.sendStats();
	}
	clearInterval(this.switchExitInterval);
    }

    show() {
	// necessary for inheritance
	// wait. is it really necessary anymore?
    }
    
    getFirePosition() {
	var position = this.exitPoints[this.exitIndex].position;
	if (typeof position == 'undefined') {
	    position = this.position;
	}
	return position;
    }
    
    render(fireAngle = this.source.pointing) {
	if (this.firing) {
	    var position = this.getFirePosition();
	    this.graphics.position.x = position[0];
	    //(this.position[0] - stagePosition[0]) + (screenW-194)/2;
	    this.graphics.position.y = -1 * position[1];
		//(this.position[1] - stagePosition[1]) + screenH/2;
	    this.graphics.clear();
	    this.graphics.lineStyle(this.meta.animation.beamWidth, this.meta.animation.beamColor);
	    this.graphics.moveTo(0,0); // Position of the beam is handled by moving the PIXI graphics
	    var x = Math.cos(fireAngle) * this.meta.animation.beamLength;
	    var y = -Math.sin(fireAngle) * this.meta.animation.beamLength;
	    this.graphics.lineTo(x,y);

	    this.renderCollisionShape(fireAngle, position);
	}
    }

    renderCollisionShape(fireAngle, position) {
	// so that the server doesn't try to render it
	this.collisionShape.moveTo(...position);
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
	this.system.spaceObjects.delete(this);
	this.system.container.removeChild(this.container);
	if (this.UUID && this.system.multiplayer[this.UUID]) {
	    delete this.system.multiplayer[this.UUID];
	}

	this.system.built.render.delete(this);
	super._removeFromSystem.call(this);
	
	
    }
    _addToSystem() {
	
	if (this.container) {
	    // To make the inheritance work (since basicWeapon calls _addToSystem)
	    this.system.container.addChild(this.container);
	}

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
};

    
if (typeof(module) !== 'undefined') {
    module.exports = beamWeapon;
}

    
