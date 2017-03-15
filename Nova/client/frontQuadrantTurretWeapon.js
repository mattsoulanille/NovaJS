if (typeof(module) !== 'undefined') {
    var turretWeapon = require("../server/turretWeaponServer.js");
    var basicWeapon = require("../server/basicWeaponServer.js");
    var _ = require("underscore");
    var Promise = require("bluebird");
}

frontQuadrantTurretWeapon = class extends turretWeapon {

    constructor(buildInfo, source) {
	super(buildInfo, source);
	this.blindspots = [false, true, true];
    }

    fire() {
	super.fire.call(this, 0);
    }

    autoFire() {
	super.autoFire.call(this);

//	basicWeapon.prototype.autoFire.call(this);
    }
}

if (typeof(module) !== 'undefined') {
    module.exports = frontQuadrantTurretWeapon;
}
