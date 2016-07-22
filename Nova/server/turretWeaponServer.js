module.exports = turretWeaponServer
var _ = require("underscore");
var Promise = require("bluebird");
var turretWeapon = require("../client/turretWeapon.js");

function turretWeaponServer(buildInfo) {
    turretWeapon.call(this, buildInfo);
}

turretWeaponServer.prototype = new turretWeapon;
