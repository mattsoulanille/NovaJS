if (typeof(module) !== 'undefined') {
    var _ = require("underscore");
    var Promise = require("bluebird");
    var basicWeapon = require("../server/basicWeaponServer.js");
    var turretWeapon = require("../server/turretWeaponServer.js");
    var beamWeapon = require("../server/beamWeaponServer.js");
    var frontQuadrantTurretWeapon = require("../server/frontQuadrantTurretWeaponServer.js");
    var inSystem = require("./inSystem.js");
    var loadsResources = require("./loadsResources.js");
}

var weaponBuilder = class extends loadsResources(inSystem) {
    constructor(buildInfo, source) {
	super(...arguments);
	this.buildInfo = buildInfo;
	this.source = source;
	if (typeof(buildInfo) !== 'undefined') {
	    this.id = this.buildInfo.id;
	    this.count = buildInfo.count || 1;
	    this.buildInfo.count = this.count;
	}
	this.type = "weapons";
    }

    async buildWeapon() {
	await this.loadResources();

	if (this.weapon && this.children.has(this.weapon)) {
	    // if rebuilding (is this even a thing that I support?)
	    this.removeChild(this.weapon);
	}

	if (['point defence', 'bay', 'beam', 'beam turret', 'point defence beam'].includes(this.meta.type)) {
	    // temporary
	    return false;
	}

	switch (this.meta.type) {
	case 'unguided':
	    this.weapon = new basicWeapon(this.buildInfo, this.source);
	    break;
	case 'guided':
	    this.weapon = new basicWeapon(this.buildInfo, this.source);
	    break;
	case 'turret':
	    this.weapon = new turretWeapon(this.buildInfo, this.source);
	    break;
	case 'beam':
	    this.weapon = new beamWeapon(this.buildInfo, this.source);
	    break;
	case 'front quadrant':
	    this.weapon = new frontQuadrantTurretWeapon(this.buildInfo, this.source);
	default:
	    this.weapon = new basicWeapon(this.buildInfo, this.source);
	    break;
	}


	await this.weapon.build();
	return this.weapon;

    }
}
if (typeof(module) !== 'undefined') {
    module.exports = weaponBuilder;
}
