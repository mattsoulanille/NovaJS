module.exports = basicWeaponServer;
var _ = require("underscore");
var Promise = require("bluebird");
var basicWeapon = require("../client/basicWeapon.js");

function basicWeaponServer(name, source, meta, count) {
    basicWeapon.call(this, name, source, meta, count);
}

basicWeaponServer.prototype = new basicWeapon;

