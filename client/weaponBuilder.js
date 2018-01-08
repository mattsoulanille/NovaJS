if (typeof(module) !== 'undefined') {
    var _ = require("underscore");
    var Promise = require("bluebird");
    var projectileWeapon = require("../server/projectileWeaponServer.js");
    var turretWeapon = require("../server/turretWeaponServer.js");
    var beamWeapon = require("../server/beamWeaponServer.js");
    var frontQuadrantTurretWeapon = require("../server/frontQuadrantTurretWeaponServer.js");
    var inSystem = require("./inSystem.js");
    var loadsResources = require("./loadsResources.js");
}

var weaponBuilder = class extends loadsResources(inSystem) {
    constructor(buildInfo, source) {
	super(...arguments);
	this.buildInfo = Object.assign({}, buildInfo); // so sub recursion works
	this.source = source;
	if (typeof(buildInfo) !== 'undefined') {
	    this.id = this.buildInfo.id;
	    this.count = buildInfo.count || 1;
	    this.buildInfo.count = this.count;
	}
	this.type = "weapons";
    }

    async _build() {
	var meta = await this.loadResources(this.type, this.buildInfo.id);
	this.meta = Object.assign({}, meta);
	// copy the subs
	this.meta.submunitions = this.meta.submunitions.map(function(s) {
	    return Object.assign({}, s);
	});
    }
    
    _setWeaponType() {

	if (['point defence', 'bay', 'beam turret', 'point defence beam'].includes(this.meta.type)) {
	    // temporary
	    return false;
	}

	switch (this.meta.type) {
	case 'unguided':
	    this.weapon = new projectileWeapon(this.buildInfo, this.source);
	    break;
	case 'guided':
	    this.weapon = new projectileWeapon(this.buildInfo, this.source);
	    break;
	case 'turret':
	    this.weapon = new turretWeapon(this.buildInfo, this.source);
	    break;
	case 'beam':
	    this.weapon = new beamWeapon(this.buildInfo, this.source);
	    break;
	case 'front quadrant':
	    this.weapon = new frontQuadrantTurretWeapon(this.buildInfo, this.source);
	    break;
	default:
	    this.weapon = new projectileWeapon(this.buildInfo, this.source);
	    break;
	}

	return true;
    }

    async buildSub(subData) {
	await this._build();

	// Fix me if you implement multiple submunitions
	this.meta.submunitions.forEach(function(s) {
	    s.limit = subData.limit;
	});

	this.buildInfo.meta = this.meta; // only okay since buildInfo was copied
	if (! this._setWeaponType()) {
	    return false;
	}

	// no beam support yet
	// replace some functions of weapon
	this.weapon.getProjectileCount = function() {
	    return subData.count;
	};

	var fire = this.weapon.fire;
	this.weapon.fire = function(direction, position, velocity) {

	    for (var i = 0; i < this.projectiles.length; i++) {
		var proj = this.projectiles[i];
		var offset = (Math.random() - 0.5) * 2 * subData.theta * 2*Math.PI / 360;
		direction = this.source.pointing + offset;
		position = position || this.source.position;
		velocity = velocity || this.source.velocity;
		this.target = this.source.target;
		proj.fire(direction, position, velocity, this.target);
	    }
	    return true;

	}.bind(this.weapon);

	await this.weapon.build();
	return this.weapon;
    }
    
    async buildWeapon() {
	await this._build();

	if (! this._setWeaponType()) {
	    return false;
	}


	await this.weapon.build();
	return this.weapon;

    }
}
if (typeof(module) !== 'undefined') {
    module.exports = weaponBuilder;
}
