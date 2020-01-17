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

    _bindListeners() {
	this.multiplayer.onQuery("getOutfits", function() {
	    return new Promise(function(fulfill, reject) {
		this.onceState("outfitUUIDSBuilt", async function() {
		    var outfits = await this.getOutfits();
		    fulfill(outfits);
		}.bind(this));
	    }.bind(this));
	}.bind(this));

	super._bindListeners();
    }
    
    async _setOutfitsListener(outfits) {
	this.properties.outfits = outfits;
	this.buildInfo.outfits = outfits;
	this._makeOutfitUUIDs();
	super._setOutfitsListener(await this.getOutfits());
	this.multiplayer.broadcast("setOutfits", await this.getOutfits());
    }

    async buildExplosion() {};
    
    setProperties() {
	super.setProperties();
	this._makeOutfitUUIDs();
    }
    
    _makeOutfitUUIDs() {
	// Assumes no more than 1 weapon per outfit, which is the case in Nova.
	var outfits;
	if (this.buildInfo.hasOwnProperty("outfits")) {
	    outfits = JSON.parse(JSON.stringify(this.buildInfo.outfits));
	}
	else {
	    var outfitObject = this.properties.outfits;
	    outfits = [];
	    for (let id in outfitObject) {
		let count = outfitObject[id];
		outfits.push({id, count});
	    }
	}

	this.properties.outfits = outfits.map(function(o) {
	    o.UUID = UUID();
	    return o;
	});

	this.setState("outfitUUIDSBuilt", true);
    }

    async getOutfits() {
	return this.properties.outfits;	
    }

    
    blinkFiringAnimation() {}
    
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

    manageFireImage() {}

    manageLights() {

    }

    manageEngine() {

    }
}
module.exports = shipServer;
