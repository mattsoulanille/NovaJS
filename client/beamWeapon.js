if (typeof(module) !== 'undefined') {
//    var _ = require("underscore");
    //    var Promise = require("bluebird");
    var collidable = require("../server/collidableServer");
    var inSystem = require("./inSystem.js");
    var PIXI = require("../server/pixistub.js");
    var basicWeapon = require("../server/basicWeaponServer.js");
    var renderable = require("./renderable.js");
    var visible = require("./visible.js");
    var errors = require("./errors.js");
    var NoSystemError = errors.NoSystemError;
}

beamWeapon = class extends collidable(visible(basicWeapon)) {

    constructor(buildInfo, source) {
	super(...arguments);

	if (this.system) {
	    // so the inheritance chain works
	    this.system.container.addChild(this.container);
	}
	    
	//this.type = "weapons";
	//this.socket = source.socket;

	//this.buildInfo = buildInfo;
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
	this.graphics.visible = true;
	this.container.addChild(this.graphics);
	
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
	
	this.show();

	if ((typeof this.UUID !== 'undefined') && notify) {
	    this.sendStats();
	}

	// Control which point the beam comes from
	// This will probably need to be written so that clients are more sure about which place a beam is coming from.
	if (! this.switchExitInterval) {
	    this.switchExitInterval = setInterval(function() {
		this.exitIndex = (this.exitIndex + 1) % this.exitPoints.length;
	    }.bind(this), this.reloadMilliseconds);
	}
	
    }

    stopFiring(notify = true) {
	this.graphics.clear();
	try {
	    this.hide();
	}
	catch(e) {
	    if (! (e instanceof NoSystemError) ) {
		throw e;
	    }
	}

	if ((typeof this.UUID !== 'undefined') && notify) {
	    this.sendStats();
	}
	clearInterval(this.switchExitInterval);
	this.switchExitInterval = null;
    }

    
    getFirePosition() {
	var position = this.exitPoints[this.exitIndex].position;
	if (typeof position == 'undefined') {
	    position = this.position;
	}
	return position;
    }

    getFireAngle() {
	return this.source.pointing;
    }

    drawBeam(start, end) {
	this.graphics.position.x = start[0];
	this.graphics.position.y = -1 * start[1];
	
	this.graphics.clear();
	this.graphics.lineStyle(this.meta.animation.beamWidth+1, this.meta.animation.beamColor);

	this.graphics.moveTo(0,0); // Position of the beam is handled by moving the PIXI graphics
	this.graphics.lineTo(end[0], end[1]);

	// This is still not quite right
	
	// Can this be optimized? Does it matter?
	let magnitude = Math.sqrt(end[0]**2 + end[1]**2);
	let orthogonal = [-end[1] / magnitude, end[0] / magnitude];

	// Why don't I have a vector class or something less annoying
	let offset = this.meta.animation.beamWidth / 2 + 1;
	this.graphics.moveTo(orthogonal[0] * offset, orthogonal[1] * offset);
	// Corona has width 1
	this.graphics.lineStyle(1, this.meta.animation.coronaColor);
	this.graphics.lineTo(end[0] + orthogonal[0]*offset, end[1] + orthogonal[1]*offset);

	this.graphics.moveTo(-orthogonal[0] * offset, -orthogonal[1] * offset);
	this.graphics.lineStyle(1, this.meta.animation.coronaColor);
	this.graphics.lineTo(end[0] - orthogonal[0]*offset, end[1] - orthogonal[1]*offset);

    }    

    render() {

	var position = this.getFirePosition();
	var fireAngle = this.getFireAngle(position);

	var x = Math.cos(fireAngle) * this.meta.animation.beamLength;
	var y = Math.sin(fireAngle) * this.meta.animation.beamLength;

	this.drawBeam(position, [x,-y]);


	this.renderCollisionShape(fireAngle, position);

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
	//this.system.spaceObjects.delete(this);
	this.system.container.removeChild(this.container);
	if (this.UUID && this.system.multiplayer[this.UUID]) {
	    delete this.system.multiplayer[this.UUID];
	}

	this.hide();
	super._removeFromSystem();
	
	
    }
    _addToSystem() {
	
	if (this.container) {
	    // To make the inheritance work (since basicWeapon calls _addToSystem)
	    this.system.container.addChild(this.container);
	}

	if (this.UUID) {
	    this.system.multiplayer[this.UUID] = this;
	}

	//this.system.spaceObjects.add(this);
	super._addToSystem();
    }
    
    
    destroy() {
	this.stopFiring(false);
	this.multiplayer.destroy();
	super.destroy();

    }

};

    
if (typeof(module) !== 'undefined') {
    module.exports = beamWeapon;
}

    
