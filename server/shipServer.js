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

    parseDefaultWeaponsSync() {
	// to be replaced by system having promises (see comment in index.js)
	// a hack to make weapon loading work
	this.buildInfo.weapons = this.meta.weapons.map(function(buildInfo) {
	    buildInfo.UUID = UUID();
	    return buildInfo;
	});
	
	
    }

    buildDefaultWeapons() {
	// Would normally parse them too. see above hack and index.js

	/*
	this.buildInfo.weapons = [];
	return Promise.all(this.meta.weapons.map(function(buildInfo) {
	    buildInfo.UUID = UUID(); // generate UUIDs for all the weapons
	    this.buildInfo.weapons.push(buildInfo);
	    return this.buildWeapon(buildInfo);
	}.bind(this)));
	*/

	return super.buildDefaultWeapons.call(this); // normally doesn't do this

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
