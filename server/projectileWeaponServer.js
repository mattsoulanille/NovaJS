var _ = require("underscore");
var Promise = require("bluebird");
var projectileWeapon = require("../client/projectileWeapon.js");

class projectileWeaponServer extends projectileWeapon {
    constructor() {
	super(...arguments);
    }

    build() {
	return super.build.call(this);
//	.then(function() {

	    
//	}.bind(this))
    }

}

module.exports = projectileWeaponServer;
