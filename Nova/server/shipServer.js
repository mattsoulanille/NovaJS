var _ = require("underscore");
var Promise = require("bluebird");
var ship = require("../client/ship.js");
var UUID = require('uuid/v4');

class shipServer extends ship {

    constructor(buildInfo, system) {
	super(...arguments);
    }

    buildTargetImage() {
	return;
    }

    buildDefaultWeapons() {
	this.buildInfo.weapons = [];
	return Promise.all(this.meta.weapons.map(function(buildInfo) {
	    buildInfo.UUID = UUID(); // generate UUIDs for all the weapons
	    this.buildInfo.weapons.push(buildInfo);
	    return this.buildWeapon(buildInfo);
	}.bind(this)));


    }

    async _build() {
	await super._build();
	
    }
    
    addSpritesToContainer() {
	
    }

    manageLights() {

    }

    manageEngine() {

    }
}
module.exports = shipServer;
