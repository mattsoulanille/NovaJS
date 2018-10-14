
const spriteSheet = require("./spriteSheet.js");
const shanParse = require("./shanParse.js");
const shipParse = require("./shipParse.js");
const weapParse = require("./weapParse.js");
const outfParse = require("./outfParse.js");
const pictParse = require("./pictParse.js");
const planetParse = require("./planetParse.js");
const systemParse = require("./systemParse.js");
const gettable = require("../libraries/gettable.js");


class novaData {
    constructor(parsed) {
	this.novaParse = parsed;
	this.parsers = {
	    spriteSheet : new spriteSheet(),
	    outfParse : new outfParse(),
	    weapParse : new weapParse(),
	    pictParse : new pictParse(),
	    planetParse : new planetParse(),
	    systemParse : new systemParse()
	};

	//this.spriteSheetImages = new gettable(
	this.spriteSheets = new gettable(this.getFunction("rlëD", this.parsers.spriteSheet));
	this.outfits = new gettable(this.getFunction("oütf", this.parsers.outfParse));
	this.weapons = new gettable(this.getFunction("wëap", this.parsers.weapParse));
	this.picts = new gettable(this.getFunction("PICT", this.parsers.pictParse));
	this.planets = new gettable(this.getFunction("spöb", this.parsers.planetParse));
	this.systems = new gettable(this.getFunction("sÿst", this.parsers.systemParse));
    }

    getFunction(resourceType, parser) {
	return async function(globalID) {
	    var index = globalID.lastIndexOf(":");
	    var prefix = globalID.slice(0, index);
	    var id = globalID.slice(index + 1);

	    var resource = this.novaParse.ids.getSpace(prefix)[resourceType][id];
	    if (resource) {
		return await parser.parse(resource);
	    }
	    else {
		throw new Error(globalID + " not found in novaParse under " + resourceType);
	    }
	}.bind(this);
    }

    async build() {
	await this.buildWeaponOutfitMap();
	
    }

    async buildWeaponOutfitMap() {
	// Nova ships are given weapons instead of outfits.
	// Figure out which outfits those weapons correspond to.
	// Doesn't work well if one outfit is two weapons.

	this.weaponOutfitMap = {};

	var promises = Object.keys(this.novaParse.ids.resources.oütf).reverse().map(async function(id) {
	    var outfit = this.novaParse.ids.resources.oütf[id];
	    var idSpace = outfit.idSpace;

	    var promises = outfit.functions.map(async function(prop) {
		var weapID = prop.weapon;
		if (prop.hasOwnProperty("weapon") && (weapID >= 128)) {
		    
		    try {
			this.weaponOutfitMap[idSpace.wëap[weapID].globalID] = id;
		    }
		    catch (e) {
			if (e instanceof TypeError) {
			    // no weapon matches the outfit's requested one
			    throw new Error("Outfit " + id +
					    " requested weapon " +
					    weapID + " but none was found");
			}
			else {
			    throw e;
			}
		    }

		}
	    }.bind(this));


	}.bind(this));


	await Promise.all(promises);
	this.parsers.shipParse = new shipParse(this.weaponOutfitMap);
	this.ships = new gettable(this.getFunction("shïp", this.parsers.shipParse));
    }
};


module.exports = novaData;
