
const spriteSheetAndImageParse = require("./spriteSheetAndImageParse.js");
const shanParse = require("./shanParse.js");
const shipParse = require("./shipParse.js");
const weapParse = require("./weapParse.js");
const outfParse = require("./outfParse.js");
const pictParse = require("./pictParse.js");
const planetParse = require("./planetParse.js");
const systemParse = require("./systemParse.js");
const explosionParse = require("./explosionParse.js");
const gettable = require("../libraries/gettable.js");
const buildable = require("../client/buildable.js"); // maybe move this out of /client?
const novaParse = require("novaparse");
const fs = require("fs");
const path = require("path");
const NoNovaFilesError = require("../client/errors.js").NoNovaFilesError;

class novaData extends buildable(function() {}) {
    constructor(path) {
	super();
	//this.novaParse = parsed;
	this.path = path;
	this.data = {};
	this.parsers = { // None of these should modify this.data directly
	    spriteSheetAndImageParse : new spriteSheetAndImageParse(this.data),
	    outfParse : new outfParse(this.data),
	    weapParse : new weapParse(this.data),
	    pictParse : new pictParse(this.data),
	    planetParse : new planetParse(this.data),
	    systemParse : new systemParse(this.data),
	    explosionParse: new explosionParse(this.data)
	};
    }

    async _build() {
	this.novaParse = new novaParse(this.path);
	var ndPath = path.join(this.path, "Nova Files");
	if (! fs.existsSync(ndPath) ) {
	    var message = "Missing Nova Files directory at " + ndPath
		+ ". Make sure to copy the Nova Files directory from " 
		+ "EV Nova into " + this.path + ". To get the Nova Files"
		+ " directory out of EV Nova, right click it and select \"Show package contents.\""
		+ " Then, navigate to Contents/Resources and copy the Nova Files directory to " + this.path;
	    var err = new NoNovaFilesError(message);
	    err.code = "ENOENT";
	    throw err;
	}

	var pluginsPath = path.join(this.path, "Plug-ins");
	if (! fs.existsSync(pluginsPath) ) {
	    console.warn("Missing Plug-ins directory at " + pluginsPath
			 + ". Creating directory now.");
	    fs.mkdirSync(pluginsPath);
	}

	await this.novaParse.read();

	await this.buildWeaponOutfitMap();
	this.parsers.shipParse = new shipParse(this.data, this.weaponOutfitMap);
	this.setupDataSources();
	this.setupIDs();
	super._build();
    }

    setupDataSources() {
	this._spriteSheetAndImages = new gettable(
	    this.getFunction("rlëD", this.parsers.spriteSheetAndImageParse));
	
	this.data.spriteSheets = new gettable(async function(globalID) {
	    return (await this._spriteSheetAndImages.get(globalID)).spriteSheet;
	}.bind(this));

	this.data.spriteSheetImages = new gettable(async function(globalID) {
	    return (await this._spriteSheetAndImages.get(globalID)).png;
	}.bind(this));

	this.data.spriteSheetFrames = new gettable(async function(globalID) {
	    return (await this._spriteSheetAndImages.get(globalID)).frameInfo;
	}.bind(this));

	// TODO: Refactor these with .ids: Define a map between my names and nova's names
	// and make these programmatically
	this.data.outfits = new gettable(this.getFunction("oütf", this.parsers.outfParse));
	this.data.weapons = new gettable(this.getFunction("wëap", this.parsers.weapParse));
	this.data.picts = new gettable(this.getFunction("PICT", this.parsers.pictParse));
	this.data.planets = new gettable(this.getFunction("spöb", this.parsers.planetParse));
	this.data.systems = new gettable(this.getFunction("sÿst", this.parsers.systemParse));
	this.data.ships = new gettable(this.getFunction("shïp", this.parsers.shipParse));
	this.data.explosions = new gettable(this.getFunction("bööm", this.parsers.explosionParse));
    }

    setupIDs() {
	this.ids = {
	    outfits: this._getIDs("oütf"),
	    weapons: this._getIDs("wëap"),
	    picts: this._getIDs("PICT"),
	    planets: this._getIDs("spöb"),
	    systems: this._getIDs("sÿst"),
	    spriteSheets: this._getIDs("rlëD"),
	    spriteSheetImages: this._getIDs("rlëD"),
	    spriteSheetFrames: this._getIDs("rlëD"),
	    ships: this._getIDs("shïp")
	};
    }
    
    _getIDs(resourceName) {
	return Object.keys(this.novaParse.ids.resources[resourceName]);
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

    buildWeaponOutfitMap() { // returns a promise
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


	return Promise.all(promises);
    }
};


module.exports = novaData;
