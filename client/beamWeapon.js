
//    var Promise = require("bluebird");
var collidable = require("../server/collidableServer.js");
var inSystem = require("./inSystem.js");
var PIXI = require("../server/pixistub.js");
var basicWeapon = require("../server/basicWeaponServer.js");
var renderable = require("./renderable.js");
var visible = require("./visible.js");
var errors = require("./errors.js");
var NoSystemError = errors.NoSystemError;
var AlliesError = errors.AlliesError;



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

    drawBeam(start, beamVector) {
	// Draws the beam from start to end where the length of the beam
	// is at most this.meta.animation.beamLength

	var scaleFactor =
	    Math.sqrt(beamVector[0] ** 2 + beamVector[1] ** 2)
	    / this.meta.animation.beamLength;
	
	var scaled = [beamVector[0] / scaleFactor, -beamVector[1] / scaleFactor];
	//var destination = [start[0] + scaled[0], start[1] + scaled[1]];
	// Should really have a vector class
	
//	this.graphics.position.x = start[0];
//	this.graphics.position.y = -1 * start[1];
	this.container.position.x = start[0];
	this.container.position.y = -1 * start[1];
	
	this.graphics.clear();
	this.graphics.lineStyle(this.meta.animation.beamWidth+1, this.meta.animation.beamColor);

	this.graphics.moveTo(0,0); // Position of the beam is handled by moving the PIXI graphics
	this.graphics.lineTo(scaled[0], scaled[1]);

	// This is still not quite right
	
	// Can this be optimized? Does it matter?
	let magnitude = Math.sqrt(scaled[0]**2 + scaled[1]**2);
	let orthogonal = [-scaled[1] / magnitude, scaled[0] / magnitude];

	// Why don't I have a vector class or something less annoying
	let offset = this.meta.animation.beamWidth / 2 + 1;
	this.graphics.moveTo(orthogonal[0] * offset, orthogonal[1] * offset);
	// Corona has width 1
	this.graphics.lineStyle(1, this.meta.animation.coronaColor);
	this.graphics.lineTo(scaled[0] + orthogonal[0]*offset, scaled[1] + orthogonal[1]*offset);

	this.graphics.moveTo(-orthogonal[0] * offset, -orthogonal[1] * offset);
	this.graphics.lineStyle(1, this.meta.animation.coronaColor);
	this.graphics.lineTo(scaled[0] - orthogonal[0]*offset, scaled[1] - orthogonal[1]*offset);

    }    

    getFireVector(startPosition) {
	var fireAngle = this.source.pointing;
	var x = Math.cos(fireAngle);
	var y = Math.sin(fireAngle);
	return [x, y];
	
    }
    
    render() {

	var position = this.getFirePosition();
	var fireVector = this.getFireVector();
	
	this.drawBeam(position, fireVector);

	// Necessary for inheritance
	var fireAngle = Math.atan2(fireVector[1], fireVector[0]);
	
	this.renderCollisionShape(fireAngle, position);

    }

    renderCollisionShape(fireAngle, position) {
	// so that the server doesn't try to render it
	this.collisionShape.moveTo(...position);
	this.collisionShape.setAngle(fireAngle);
    }

    get allies() {
	return new Set([...this.source.allies, this]);
    }

    set allies(a) {
	throw new AlliesError("Tried to set allies of a beam weapon but they are defined implicitly by source");
    }

    collideWith(other, res) {
	//console.log(res);
	var delta = (other.delta) * 60 / 1000;

	if (other.properties.vulnerableTo &&
	    other.properties.vulnerableTo.includes(this.properties.damageType) &&
	    !this.allies.has(other)) {
	    
	    
	    var collision = {};
	    collision.shieldDamage = this.properties.shieldDamage * delta;
	    collision.armorDamage = this.properties.armorDamage * delta;
	    collision.ionizationDamage = this.properties.ionizationDamage * delta;
	    collision.ionizationColor = this.properties.ionizationColor;
	    collision.passThroughShields = this.meta.passThroughShields;
	    // needs improvement for proper tractoring
	    //collision.impact = this.properties.impact * delta;

	    // fix this
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
    
    
    _destroy() {
	super._destroy();
    }

};

module.exports = beamWeapon;


    
