var _ = require("underscore");
var Promise = require("bluebird");
var turretWeapon = require("../client/turretWeapon.js");

// function turretWeaponServer(buildInfo, source) {
//     turretWeapon.call(this, buildInfo, source);
// }

// turretWeaponServer.prototype = new turretWeapon;

turretWeaponServer = turretWeapon;

module.exports = turretWeaponServer;
