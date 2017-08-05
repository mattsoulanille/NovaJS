
var novaCache = class {
    constructor() {
	
	this.ships = new cache("objects/ships/");
	this.shans = new cache("objects/shans/");
	this.spriteSheets = new spriteSheetCache("objects/spriteSheets/");
	this.weapons = new cache("objects/weapons/");

	this.misc = new cache("objects/misc/");
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
