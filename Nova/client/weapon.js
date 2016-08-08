if (typeof(module) !== 'undefined') {
    module.exports = weapon;
    var _ = require("underscore");
    var Promise = require("bluebird");
    var basicWeapon = require("../server/basicWeaponServer.js");
    var turretWeapon = require("../server/turretWeaponServer.js");
    var beamWeapon = require("../server/beamWeaponServer.js");
    var frontQuadrantTurretWeapon = require("../server/frontQuadrantTurretWeaponServer.js");
}


function weapon(buildInfo, source) {
    this.url = 'objects/weapons/';
    this.buildInfo = buildInfo;
    this.source = source;
    if (typeof(buildInfo) !== 'undefined') {
	this.name = buildInfo.name;
	this.count = buildInfo.count || 1;
	this.buildInfo.count = this.count;
    }
}

weapon.prototype.build = function() {
    return this.loadResources()
	.then(this.buildWeapon.bind(this));

}

weapon.prototype.loadResources = function() {
    return new Promise( function(fulfill, reject) {
	
	$.getJSON(this.url + this.name + ".json", _.bind(function(data) {

	    this.meta = data;

	    if ((typeof(this.meta) !== 'undefined') && (this.meta !== null)) {
		fulfill();
	    }
	    else {
		reject();
	    }

	}, this));

    }.bind(this));
}

weapon.prototype.buildWeapon = function() {
     var buildInfo = {
     	"name":this.name,
     	"meta":this.meta,
     	"count":this.count
     };

    if (typeof this.buildInfo.UUID !== 'undefined') {
	buildInfo.UUID = this.buildInfo.UUID;
    }
    if (typeof this.buildInfo.socket !== 'undefined') {
	buildInfo.socket = this.buildInfo.socket;
    }

    switch (this.meta.physics.type) {
    case undefined:
	this.weapon = new basicWeapon(buildInfo, this.source);
	break;
    case 'unguided':
	this.weapon = new basicWeapon(buildInfo, this.source);
	break;
    case 'guided':
	this.weapon = new basicWeapon(buildInfo, this.source);
	break;
    case 'turret':
	this.weapon = new turretWeapon(buildInfo, this.source);
	break;
    case 'beam':
	this.weapon = new beamWeapon(buildInfo, this.source);
	break;
    case 'front quadrant':
	this.weapon = new frontQuadrantTurretWeapon(buildInfo, this.source);

    }
    return this.weapon.build();
}

weapon.prototype.fire = function() {
    return this.weapon.fire();
}

weapon.prototype.startFiring = function() {
    return this.weapon.startFiring();
}

weapon.prototype.stopFiring = function() {
    return this.weapon.stopFiring();
}

weapon.prototype.cycleTarget = function(target) {
    return this.weapon.cycleTarget(target);
}

weapon.prototype.destroy = function() {
    return this.weapon.destroy();
}
