if (typeof(module) !== 'undefined') {
    var turretWeapon = require("../server/turretWeaponServer.js");
    var _ = require("underscore");
    var Promise = require("bluebird");
}

frontQuadrantTurretWeapon = class extends turretWeapon {

    constructor(buildInfo, source) {
	super(buildInfo, source);
	this.fireWithoutTarget = true;
	this.blindspots = [false, true, true];
    }

    fire() {
	super.fire.call(this, 0);
    }

    autoFire() {
	super.autoFire.call(this);

    }
};

if (typeof(module) !== 'undefined') {
    module.exports = frontQuadrantTurretWeapon;
}
