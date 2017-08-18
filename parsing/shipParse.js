
var shanParse = require("./shanParse.js");
var baseParse = require("./baseParse.js");
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
	// temporary. Should replace with
	// parsing what outfit each weapon
	// corresponds to and just giving
	// the ship that outfit.
	this.weapons = [];
	ship.weapons.forEach(function(weapon) {
	    if ( (weapon.id >= 128) && (weapon.count > 0) ) {
		var out = {};
		out.count = weapon.count;
		var w = ship.idSpace.wëap[weapon.id];
		out.id = w.globalID;
		this.weapons.push(out);
	    }
	}.bind(this));

	
	
    }
};

module.exports = shipParse;
