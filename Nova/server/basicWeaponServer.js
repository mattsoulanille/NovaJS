var _ = require("underscore");
var Promise = require("bluebird");
var basicWeapon = require("../client/basicWeapon.js");

class basicWeaponServer extends basicWeapon {
    constructor() {
	super(...arguments);
    }

    build() {
	return super.build.call(this);
//	.then(function() {

	    
//	}.bind(this))
    }


    destory() {};
}

module.exports = basicWeaponServer;
