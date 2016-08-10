module.exports = basicWeaponServer;
var _ = require("underscore");
var Promise = require("bluebird");
var basicWeapon = require("../client/basicWeapon.js");

function basicWeaponServer(buildInfo, source) {
    basicWeapon.call(this, buildInfo, source);
}

basicWeaponServer.prototype = new basicWeapon;

basicWeaponServer.prototype.notifyServer = function() {};

basicWeaponServer.prototype.destory = function() {};

