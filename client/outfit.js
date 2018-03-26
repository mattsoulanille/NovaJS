if (typeof(module) !== 'undefined') {
    var _ = require("underscore");
    var Promise = require("bluebird");
    var loadsResources = require("./loadsResources.js");
    var inSystem = require("./inSystem.js");
    // should make inSystem into a mixin and make a base class
    // that one can add to the prototype chain of.

    var weaponBuilder = require("../server/weaponBuilderServer.js");
    var errors = require("../client/errors.js");
    var UnsupportedWeaponTypeError = errors.UnsupportedWeaponTypeError;
}


var outfit = class extends loadsResources(inSystem) {
    constructor(buildInfo, source) {
	// source is a ship / object the outfit is equipped to
	super(...arguments);
	this.source = source;
	this.buildInfo = buildInfo;
	this.built = false;;
	this.type = "outfits";
	if (typeof(buildInfo) !== 'undefined') {
	    this.id = this.buildInfo.id;
	    this.count = buildInfo.count || 1;
	}
	this.weapons = [];
    }
    

    async build() {
	this.meta = await this.loadResources(this.type, this.id);
	this.name = this.meta.name; // purely cosmetic. No actual function
	await this.buildWeapons();
	this.applyEffects();
	this.built = true;
    }

    buildWeapons() {
	this.weapons = [];
	var promises = this.meta.weapons.map(function(buildInfo) {
	    // TEMPORARY
	    var copy = JSON.parse(JSON.stringify(buildInfo));
	    copy.count = this.count;
	    // copy.UUID = Math.random();
	    return this.buildWeapon(copy);
	}.bind(this));



	return Promise.all(promises);
    }

    async buildWeapon(buildInfo) {
	try {
	    var newWeapon = await new weaponBuilder(buildInfo, this.source).buildWeapon();
	}
	catch (e) {
	    if (! (e instanceof UnsupportedWeaponTypeError) ) {
		throw e;
	    }
	}
	if (newWeapon) {
	    // temporary for when not all weapon types can be made
	    this.addChild(newWeapon);
	    this.weapons.push(newWeapon);
	}
    }
    
    applyEffects() {
	
	if (this.meta.functions["speed increase"]) {
	    this.source.properties.maxSpeed += this.meta.functions["speed increase"] * this.count;
	}
	
    }

    destroy() {
	this.weapons.forEach(function(w) {w.destroy();});
	
    }
};

if (typeof(module) !== 'undefined') {
    module.exports = outfit;
}
