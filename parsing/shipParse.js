var shanParse = require("./shanParse.js");
var baseParse = require("./baseParse.js");
var explosionParse = require("./explosionParse.js");
var shipParse = class extends baseParse {
    constructor(ship) {
	super(...arguments);
	
	this.shanID = this.id;
	this.prefix = ship.prefix;

	this.animation = new shanParse(ship.idSpace.shän[ship.id]);
	
	this.shield = ship.shield;
	this.shieldRecharge = ship.shieldRecharge;
	this.armor = ship.armor;
	this.armorRecharge = ship.armorRecharge;
	this.energy = ship.energy;
	this.energyRecharge = ship.energyRecharge;
	this.ionization = ship.ionization;
	this.deionize = ship.deionize;

	this.speed = ship.speed;
	this.acceleration = ship.acceleration;
	this.turnRate = ship.turnRate;

	this.mass = ship.mass;


	var outfits = {};

	// Put the outfit corresponding to each weapon into the outfit object
	// Doesn't deal with ammo yet.
	ship.weapons.forEach(function(weapon) {
	    if ( (weapon.id >= 128) && (weapon.count > 0) ) {

		var weaponID = ship.idSpace.wëap[weapon.id].globalID;

		// Expects this.weaponOutfitMap to have been set in the prototype chain
		if (weaponID in this.weaponOutfitMap) {
		    
		    let outfitID = this.weaponOutfitMap[weaponID]; // A global ID
		    if (!outfits.hasOwnProperty(outfitID)) {
			outfits[outfitID] = 0; // the number of outfits of this ID
		    }
		    outfits[outfitID] += weapon.count;
		}
	    }
	}.bind(this));


	// Do the same for the outfits themselves
	ship.outfits.forEach(function(outfit) {
	    if ( (outfit.id >= 128) && (outfit.count > 0) ) {
		var outfitID = ship.idSpace.oütf[outfit.id].globalID;

		if (!outfits.hasOwnProperty(outfitID)) {
		    outfits[outfitID] = 0; // the number of outfits of this ID
		}
		outfits[outfitID] += outfit.count;

	    }

	}.bind(this));		


	this.outfits = Object.keys(outfits).map(function(id) {
	    return {"id" : id, "count" : outfits[id]};
	});
	

	if (ship.initialExplosion >= 128) {
	    let boom = ship.idSpace.bööm[ship.initialExplosion];
	    this.initialExplosion = new explosionParse(boom);
	}
	else {
	    this.initialExplosion = null;
	}
	
	if (ship.finalExplosion >= 128) {
	    let boom = ship.idSpace.bööm[ship.finalExplosion];
	    this.finalExplosion = new explosionParse(boom);
	}
	else {
	    this.finalExplosion = null;
	}
	
	this.deathDelay = ship.deathDelay / 60 * 1000;
	if (ship.deathDelay >= 60) {
	    this.largeExplosion = true;
	}
	
	
    }
};

module.exports = shipParse;
