module.exports = frontQuadrantTurretWeaponServer;
var frontQuadrantTurretWeapon = require("../client/frontQuadrantTurretWeapon.js");


function frontQuadrantTurretWeaponServer(buildInfo, source) {
    frontQuadrantTurretWeapon.call(this, buildInfo, source);
}

frontQuadrantTurretWeaponServer.prototype = new frontQuadrantTurretWeapon;
