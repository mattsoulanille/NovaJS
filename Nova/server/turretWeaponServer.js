module.exports = turretWeaponServer
var _ = require("underscore");
var Promise = require("bluebird");
var turretWeapon = require("../client/turretWeapon.js");

function turretWeaponServer(name, source, meta, count) {
    turretWeapon.call(this, name, source, meta, count);
}

turretWeaponServer.prototype = new turretWeapon;
