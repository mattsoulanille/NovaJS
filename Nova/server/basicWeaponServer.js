module.exports = basicWeaponServer;
var _ = require("underscore");
var Promise = require("bluebird");
var basicWeapon = require("../client/basicWeapon.js");

function basicWeaponServer(buildInfo) {
    basicWeapon.call(this, buildInfo);
}

basicWeaponServer.prototype = new basicWeapon;

