var _ = require("underscore");
var Promise = require("bluebird");
var projectileWeapon = require("../client/projectileWeapon.js");

class projectileWeaponServer extends projectileWeapon {
    constructor() {
	super(...arguments);
    }


}

module.exports = projectileWeaponServer;
