
var novaCache = class {
    constructor() {
	this.ships = new cache("objects/ships/");

	this.spriteSheets = new spriteSheetCache("objects/spriteSheets/");
	this.weapons = new cache("objects/weapons/");

	this.misc = new cache("objects/misc/");
    }

};
