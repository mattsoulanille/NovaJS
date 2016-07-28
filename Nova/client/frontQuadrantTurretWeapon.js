if (typeof(module) !== 'undefined') {
    module.exports = frontQuadrantTurretWeapon;
    var turretWeapon = require("../server/turretWeaponServer.js");
    var basicWeapon = require("../server/basicWeaponServer.js");
    var _ = require("underscore");
    var Promise = require("bluebird");
}

function frontQuadrantTurretWeapon(buildInfo, source) {
    turretWeapon.call(this, buildInfo, source);
    this.blindspots = [false, true, true];
}

frontQuadrantTurretWeapon.prototype = new turretWeapon;

frontQuadrantTurretWeapon.prototype.fire = function() {
    turretWeapon.prototype.fire.call(this, 0);
}
frontQuadrantTurretWeapon.prototype.autoFire = function() {
    basicWeapon.prototype.autoFire.call(this);
    
}
