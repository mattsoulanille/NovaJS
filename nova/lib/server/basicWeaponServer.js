
var _ = require("underscore");
var Promise = require("bluebird");
var basicWeapon = require("../client/basicWeapon.js");

class basicWeaponServer extends basicWeapon {
    constructor() {
	super(...arguments);
    }
}

module.exports = basicWeaponServer;
