if (typeof(module) !== 'undefined') {
    var _ = require("underscore");
    var Promise = require("bluebird");
    var basicWeapon = require("../server/basicWeaponServer.js");
    var turretWeapon = require("../server/turretWeaponServer.js");
    var beamWeapon = require("../server/beamWeaponServer.js");
    var frontQuadrantTurretWeapon = require("../server/frontQuadrantTurretWeaponServer.js");
    var inSystem = require("./inSystem.js");
}


// Should this be a mixin? should classes of weapons be mixins?

weapon = class extends inSystem {
    constructor(buildInfo, source) {
	super(...arguments);
	this.url = 'objects/weapons/';
	this.buildInfo = buildInfo;
	this.source = source;
	if (typeof(buildInfo) !== 'undefined') {
	    this.name = buildInfo.name;
	    this.count = buildInfo.count || 1;
	    this.buildInfo.count = this.count;
	}
    }

    build() {
	return this.loadResources()
	    .then(this.buildWeapon.bind(this));
	
    }

    loadResources() {
	return new Promise( function(fulfill, reject) {
	    
	    var url = this.url + this.name + ".json";
	    
	    var loader = new PIXI.loaders.Loader();
	    var data;
	    loader
		.add('meta', url)
		.load(function(loader, resource) {
		    this.meta = resource.meta.data;
		}.bind(this))
		.once('complete', function() {fulfill()});
	}.bind(this));
    }
    
			

    buildWeapon() {
	var buildInfo = {
     	    "name":this.name,
     	    "meta":this.meta,
     	    "count":this.count
	};

	if (this.weapon && this.children.has(this.weapon)) {
	    this.removeChild(this.weapon);
	}

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
	this.addChild(this.weapon);
	return this.weapon.build();
    }
    
    fire() {
	return this.weapon.fire();
    }

    startFiring() {
	return this.weapon.startFiring();
    }

    stopFiring() {
	return this.weapon.stopFiring();
    }

    setTarget(target) {
	return this.weapon.setTarget(target);
    }

    destroy() {
	return this.weapon.destroy();
    }
}
if (typeof(module) !== 'undefined') {
    module.exports = weapon;
}
