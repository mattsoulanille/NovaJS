
var spriteSheet = require("./spriteSheet.js");
var shanParse = require("./shanParse.js");
var shipParse = require("./shipParse.js");
var weapParse = require("./weapParse.js");
var outfParse = require("./outfParse.js");
var pictParse = require("./pictParse.js");
var planetParse = require("./planetParse.js");
var systemParse = require("./systemParse.js");

var gettable = class {
    constructor(getFunction) {
	this.data = {};
	this.getFunction = getFunction;
    }

    async get(thing) {
	if (! (thing in this.data) ) {
	    this.data[thing] = this.getFunction(thing);
	}

	return await this.data[thing];
    }
};


// should mirror novaCache.js

var novaData = class {
    constructor(parsed) {
	this.novaParse = parsed;
	this.spriteSheets = new gettable(this.getFunction("rlëD", spriteSheet));
	this.outfits = new gettable(this.getFunction("oütf", outfParse));
	this.weapons = new gettable(this.getFunction("wëap", weapParse));
	this.picts = new gettable(this.getFunction("PICT", pictParse));
	this.planets = new gettable(this.getFunction("spöb", planetParse));
	this.systems = new gettable(this.getFunction("sÿst", systemParse));
    }

    getFunction(resourceType, toBuild) {

	return async function(fullId) {
	    var index = fullId.lastIndexOf(":");
	    var prefix = fullId.slice(0, index);
	    var id = fullId.slice(index + 1);

	    var resource = this.novaParse.ids.getSpace(prefix)[resourceType][id];
	    if (resource) {
		let obj =  new toBuild(resource);
		if ("build" in obj) {
		    await obj.build();
		}
		return obj;
	    }
	    else {
		throw new Error(fullId + " not found in novaParse under " + resourceType);
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
	shipParse.prototype.weaponOutfitMap = this.weaponOutfitMap;
	this.ships = new gettable(this.getFunction("shïp", shipParse));
    }
};


module.exports = novaData;
