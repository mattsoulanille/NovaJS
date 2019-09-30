//var Promise = require("bluebird");
var loadsResources = require("./loadsResources.js");
var inSystem = require("./inSystem.js");
// should make inSystem into a mixin and make a base class
// that one can add to the prototype chain of.

var weaponBuilder = require("../server/weaponBuilderServer.js");
var errors = require("../client/errors.js");
var UnsupportedWeaponTypeError = errors.UnsupportedWeaponTypeError;

var outfit = class extends loadsResources(inSystem) {
    constructor(buildInfo, source) {
	// source is a ship / object the outfit is equipped to
	super(...arguments);
	this.source = source;
	this.buildInfo = buildInfo;
	this.built = false;;
	this.type = "Outfit";
	this.UUID = null;
	if (typeof(buildInfo) !== 'undefined') {
	    this.id = this.buildInfo.id;
	    this.count = buildInfo.count || 1;
	    if (buildInfo.UUID) {
		this.UUID = buildInfo.UUID;
	    }
	}
	this.weapon = null;
    }
    

    async build() {
	this.meta = await this.loadResources(this.type, this.id);
	this.name = this.meta.name; // purely cosmetic. No actual function
	if (this.meta.weapons) {
	    await this.buildWeapon();
	}
	this.applyEffects();
	this.built = true;
    }

    async buildWeapon() {
	var weaponID = Object.keys(this.meta.weapons)[0];
	if (! weaponID) {
	    return;
	}
	var buildInfo = await this.data.Weapon.get(weaponID);
	buildInfo.count = this.count;
	buildInfo.UUID = this.UUID;

	try {
	    var newWeapon = await new weaponBuilder(buildInfo, this.source).buildWeapon();
	}
	catch (e) {
	    if (! (e instanceof UnsupportedWeaponTypeError) ) {
		throw e;
	    }
	    // temporary for when not all weapon types can be made
	    console.log("Unsupported weapon type " + e.message);
	    return;
	}

	
	this.addChild(newWeapon);
	this.weapon = newWeapon;

    }
    
    applyEffects() {

	var outfPhysics = this.meta.physics;
	var shipPhysics = this.source.properties.physics;

	for (let i in outfPhysics) {
	    if (shipPhysics.hasOwnProperty(i) && (i != "afterburner")) {
		shipPhysics[i] += outfPhysics[i] * this.count;
	    }
	}

	if (outfPhysics.hasOwnProperty("afterburner")) {
	    // Use the most efficient afterburner
	    if (shipPhysics.afterburnerFuel === null) {
		shipPhysics.afterburnerFuel = Math.max(0, outfPhysics["afterburner"]);
	    }
	    else {
		shipPhysics.afterburnerFuel = Math.max(0, Math.min(shipPhysics.afterburnerFuel,
								  outfPhysics["afterburner"]));
	    }

	}

	if (outfPhysics.hasOwnProperty("fuel scoop")) {
	    shipPhysics.energyRecharge += outfPhysics["fuel scoop"];
	}
	

	    
	
    }

    _addToSystem() {}
    _removeFromSystem() {}
	
    // destroy() {
    //  // Handled by inSystem
    // }
};

module.exports = outfit;

