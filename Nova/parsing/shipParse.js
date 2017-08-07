
var shanParse = require("./shanParse.js");

var shipParse = class {
    constructor(ship) {
	this.id = ship.prefix + ":" + ship.id;
	this.name = ship.name;
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
		out.id = this.prefix + ":" + weapon.id;
		this.weapons.push(out);
	    }
	}.bind(this));

	
	
    }
};

module.exports = shipParse;
