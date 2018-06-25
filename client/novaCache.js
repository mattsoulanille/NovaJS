var cache = require("./cache.js");
var spriteSheetCache = require("./spriteSheetCache.js");
var novaCache = class {
    constructor() {
	
	this.ships = new cache("objects/ships/");
	this.shans = new cache("objects/shans/");
	this.spriteSheets = new spriteSheetCache("objects/spriteSheets/");
	this.weapons = new cache("objects/weapons/");
	this.planets = new cache("objects/planets/");

	this.misc = new cache("objects/misc/");
	this.statusBars = new cache("objects/statusBars/");
	this.outfits = new cache("objects/outfits/");
    }

    // should mirror novaData.js

    
    // the reason for these functions is that objects
    // on the server need to get these too and this
    // way is simpler. see server/novaCacheServer.js
    /*    
    getShip(id) {
	return this.ships.get(id);
    }

    getShan(id) {
	return this.shans.get(id);
    }
    
    getSpriteSheet(id) {
	return this.spriteSheets.get(id);
    }

    getWeapon(id) {
	return this.weapons.get(id);
    }
    */

};
module.exports = novaCache;
