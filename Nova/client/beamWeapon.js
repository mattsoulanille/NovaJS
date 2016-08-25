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

beamWeapon.prototype.crash = collidable.prototype.crash;
beamWeapon.prototype.build = function() {
    this.graphics = new PIXI.Graphics();
    stage.addChild(this.graphics);
    this.source.system.built.render.push(this);
    this.source.weapons.all.push(this);
    this.ready = true;
    
    this.meta.physics.length;
//    this.collisionShape = new this.crash.Polygon(
};

beamWeapon.prototype.startFiring = function() {
    this.graphics.visible = true;
    this.rendering = true;
    this.firing = true;
    if (typeof this.UUID !== 'undefined') {
	this.notifyServer();
    }

}

beamWeapon.prototype.stopFiring = function() {
    this.firing = false;
    this.graphics.clear();
    this.graphics.visible = false;
    this.rendering = false;
    if (typeof this.UUID !== 'undefined') {
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
	    this.graphics.visible = true;
	    this.rendering = true;
	    this.firing = true;
	}
	else {
	    this.firing = false;
	    this.graphics.clear();
	    this.graphics.visible = false;
	    this.rendering = false;
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
    }
}

beamWeapon.prototype.detectCollisions = function(toCheck) {
    // tom writes this.
    // returns the object in toCheck that is the first thing the beam intersects.
}

    
beamWeapon.prototype.destroy = function() {

    var index = this.system.built.render.indexOf(this);
    if (index !== -1) {
	this.system.built.render.splice(index, 1);
    }
}

beamWeapon.prototype.cycleTarget = function(target) {
    this.target = target;
}
