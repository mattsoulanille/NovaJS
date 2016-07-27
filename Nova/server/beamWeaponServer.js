module.exports = beamWeaponServer;
var beamWeapon = require("../client/beamWeapon.js");

function beamWeaponServer(buildInfo, source) {
    beamWeapon.call(this, buildInfo, source);
}

beamWeaponServer.prototype = new beamWeapon;

beamWeaponServer.prototype.build = function() {};

beamWeaponServer.prototype.startFiring = function() {};
beamWeaponServer.prototype.stopFiring = function() {};

beamWeaponServer.prototype.render = function() {};
