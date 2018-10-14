var shanParse = require("./shanParse.js");
var baseParse = require("./baseParse.js");
var explosionParse = require("./explosionParse.js");
class shipParse extends baseParse {
    constructor(weaponOutfitMap) {
	super(...arguments);
	this.weaponOutfitMap = weaponOutfitMap;
    }
    
    async parse(ship) {
	var out = await super.parse(ship);
	
	out.shanID = out.id;

	try {
	    out.pictID = ship.idSpace.PICT[ship.pictID].globalID;
	}
	catch(e) {
	    console.log("Parsing pict failed: " + e.message);
	}

	try {
	    out.desc = ship.idSpace.dësc[ship.descID].string;
	}
	catch(e) {
	    out.desc = "Parsing desc failed: " + e.message;
	}

	out.animation = new shanParse(ship.idSpace.shän[ship.id]);
	
	out.shield = ship.shield;
	out.shieldRecharge = ship.shieldRecharge;
	out.armor = ship.armor;
	out.armorRecharge = ship.armorRecharge;
	out.energy = ship.energy;
	out.energyRecharge = 1 / ship.energyRecharge; // units / frame instead of frames / unit
	out.ionization = ship.ionization;
	out.deionize = ship.deionize;

	out.speed = ship.speed;
	out.acceleration = ship.acceleration;
	out.turnRate = ship.turnRate;

	out.mass = ship.mass;
	
	var outfits = {};

	// Put the outfit corresponding to each weapon into the outfit object
	// Doesn't deal with ammo yet.
	ship.weapons.forEach(function(weapon) {
	    if ( (weapon.id >= 128) && (weapon.count > 0) ) {

		var weaponID = ship.idSpace.wëap[weapon.id].globalID;

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

	// Why is this done?
	out.outfits = Object.keys(outfits).map(function(id) {
	    return {"id" : id, "count" : outfits[id]};
	});

	// Calculate the free mass of the ship from the
	// initial free mass and the stock outfits.
	out.freeMass = ship.freeSpace;
	for (let index in out.outfits) {
	    var outfitID = out.outfits[index].id;
	    var outfit = ship.globalSpace.oütf[outfitID];
	    var count = out.outfits[index].count;
	    out.freeMass += outfit.mass * count;
	}

	

	if (ship.initialExplosion >= 128) {
	    let boom = ship.idSpace.bööm[ship.initialExplosion];
	    out.initialExplosion = new explosionParse(boom);
	}
	else {
	    out.initialExplosion = null;
	}
	
	if (ship.finalExplosion >= 128) {
	    let boom = ship.idSpace.bööm[ship.finalExplosion];
	    out.finalExplosion = new explosionParse(boom);
	}
	else {
	    out.finalExplosion = null;
	}
	
	out.deathDelay = ship.deathDelay / 60 * 1000;
	if (ship.deathDelay >= 60) {
	    out.largeExplosion = true;
	}

	out.displayWeight = ship.id; // FIX ME ONCE DISPLAYWEIGHT IS PARSED

	return out;
    }
};

module.exports = shipParse;
