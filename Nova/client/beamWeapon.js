if (typeof(module) !== 'undefined') {
    module.exports = beamWeapon;
//    var _ = require("underscore");
    //    var Promise = require("bluebird");
    var collidable = require("../server/collidableServer");
}

function beamWeapon(buildInfo, source) {
    this.buildInfo = buildInfo;
    this.firing = false;
    this.doAutoFire = false;
    this.ready = false;
    this.source = source;
    this.rendering = false;
    if (typeof source !== 'undefined') {
	this.position = source.position;
    }
    if (typeof(buildInfo) !== 'undefined') {

	this.name = buildInfo.name;
	this.meta = buildInfo.meta;

	this.system = this.source.system;
	this.count = buildInfo.count || 1
	this.UUID = buildInfo.UUID;
	if (typeof this.UUID !== 'undefined') {
	    this.system.multiplayer[this.UUID] = this;
	}
    }
}


// need to make this work on the server.... maybe refactor.
beamWeapon.prototype.crash = collidable.prototype.crash;


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


beamWeapon.prototype.build = function() {
    this.graphics = new PIXI.Graphics();
    stage.addChild(this.graphics);
    this.source.system.built.render.push(this);
    this.source.weapons.all.push(this);
    this.ready = true;
    
    var length = this.meta.physics.length;
    var halfWidth = this.meta.physics.width / 2;
    var collisionPoints = [new this.crash.V(0, halfWidth),
			   new this.crash.V(0, -halfWidth),
			   new this.crash.V(length, -halfWidth),
			   new this.crash.V(length, halfWidth)
			  ];
    this.collisionShape = new this.crash.Polygon(new this.crash.V, collisionPoints, false, this);
};

beamWeapon.prototype.startFiring = function(notify = true) {

    this.graphics.visible = true;
    this.rendering = true;
    this.firing = true;
    if ( !(this.crash.all().includes(this.collisionShape)) ) {
	this.collisionShape.insert();
    }
    if ((typeof this.UUID !== 'undefined') && notify) {
	this.notifyServer();
    }

}

beamWeapon.prototype.stopFiring = function(notify = true) {
    this.firing = false;
    this.graphics.clear();
    this.graphics.visible = false;
    this.rendering = false;
    this.collisionShape.remove();
    if ((typeof this.UUID !== 'undefined') && notify) {
	this.notifyServer();
    }

}

beamWeapon.prototype.getStats = function() {
    var stats = {};
    stats.firing = this.firing;
    return stats;
}

beamWeapon.prototype.updateStats = function(stats) {
    if (typeof stats.firing !== 'undefined') {
	if (stats.firing) {
	    this.startFiring(false);
	}
	else {
	    this.stopFiring(false);
	}
    }
}


beamWeapon.prototype.notifyServer = function() {
    var stats = this.getStats();
    var with_uuid = {};
    with_uuid[this.UUID] = stats;
    this.socket.emit('updateStats', with_uuid);
}

beamWeapon.prototype.render = function(fireAngle) {
    if (this.firing) {
	this.graphics.position.x =
	    (this.position[0] - stagePosition[0]) + (screenW-194)/2;
	this.graphics.position.y = -1 *
	    (this.position[1] - stagePosition[1]) + screenH/2;
	this.graphics.clear();
	this.graphics.lineStyle(this.meta.physics.width, this.meta.physics.color);
	this.graphics.moveTo(0,0); // Position of the beam is handled by moving the PIXI graphics
	var fireAngle = fireAngle || this.source.pointing;
	var x = Math.cos(fireAngle) * this.meta.physics.length;
	var y = -Math.sin(fireAngle) * this.meta.physics.length;
	this.graphics.lineTo(x,y);

	this.collisionShape.moveTo(...this.position);
	this.collisionShape.setAngle(fireAngle);
	
    }

}
beamWeapon.prototype.properties = {};
//beamWeapon.prototype.properties.vulnerableTo = ["normal"];


beamWeapon.prototype.collideWith = function(other, res) {
    console.log(res);
    var delta = (other.delta) * 60 / 1000;
    if (other.properties.vulnerableTo &&
	other.properties.vulnerableTo.includes("normal") &&
	other !== this.source) {
	
	var collision = {};
	collision.shieldDamage = this.meta.properties.shieldDamage * delta;
	collision.armorDamage = this.meta.properties.armorDamage * delta;
	// needs improvement for proper tractoring
	collision.impact = this.meta.properties.impact * delta;
	collision.angle = this.pointing;

//	console.log(collision);
	other.receiveCollision(collision);
    }

}

beamWeapon.prototype.receiveCollision = function(collision) {}

    
beamWeapon.prototype.destroy = function() {
    this.stopFiring();
    var index = this.system.built.render.indexOf(this);
    if (index !== -1) {
	this.system.built.render.splice(index, 1);
    }
}

beamWeapon.prototype.setTarget = function(target) {
    this.target = target;
}
