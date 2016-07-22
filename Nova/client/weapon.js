if (typeof(module) !== 'undefined') {
    module.exports = weapon;
    var _ = require("underscore");
    var Promise = require("bluebird");
    var basicWeapon = require("../server/basicWeaponServer.js");
    var turretWeapon = require("../server/turretWeaponServer.js");
}


function weapon(buildInfo) {
    this.url = 'objects/weapons/';
    if (typeof(buildInfo) !== 'undefined') {
	this.name = buildInfo.name;
	this.source = buildInfo.source;
	this.count = buildInfo.count || 1;
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
	"source":this.source,
	"meta":this.meta,
	"count":this.count
    };
    switch (this.meta.physics.type) {
    case undefined:
	this.weapon = new basicWeapon(buildInfo);
	break;
    case 'unguided':
	this.weapon = new basicWeapon(buildInfo);
	break;
    case 'guided':
	this.weapon = new basicWeapon(buildInfo);
	break;
    case 'turret':
	this.weapon = new turretWeapon(buildInfo);
	break;
    }
    return this.weapon.build()
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
