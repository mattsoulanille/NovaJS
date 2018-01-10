"use strict";

var base = require("./base.js");

var ship = class extends base {

    constructor(resource) {
	super(...arguments);
	var d = this.data;

	var adj = function(n,a) {
	    if (n == -1)
		return null;
	    return n+a;
	}
	
	this.cargoSpace = d.getInt16(0);
	this.shield = d.getInt16(2);
	this.acceleration = d.getInt16(4);
	this.speed = d.getInt16(6);
	this.turnRate = d.getInt16(8);
	this.energy = d.getInt16(10);
	this.freeSpace = d.getInt16(12);
	this.armor = d.getInt16(14);
	this.shieldRecharge = d.getInt16(16);

	//stock weapons
	this.weapons = [];
	for (var i = 0; i < 8 ; i ++){
	    this.weapons[i] = {};
	    this.weapons[i].id = d.getInt16(18+2*i);
	    this.weapons[i].count = d.getInt16(26+2*i);
	    this.weapons[i].ammo = d.getInt16(34+2*i);
	    
	}
	this.maxGuns = d.getInt16(42);
	this.maxTurrets = d.getInt16(44);
	this.techLevel = d.getInt16(46);
	//???
	this.cost = d.getInt16(50);
	//weaps is strange
	for (var i = 4; i < 8 ; i ++){
	    this.weapons[i] = {};
	    this.weapons[i].id = d.getInt16(42+2*i);
	    this.weapons[i].count = d.getInt16(50+2*i);
	    this.weapons[i].ammo = d.getInt16(58+2*i);
	    
	}


	

	this.deathDelay = d.getInt16(52);
	this.armorRecharge = d.getInt16(54);
	this.initialExplosion = adj(d.getInt16(56),128);
	this.finalExplosion = adj(d.getInt16(58),128);
	this.finalExplosionSparks = false;
	if (this.finalExplosion >= 1000) {
	    this.finalExplosion -= 1000;
	    this.finalExplosionSparks = true;
	}
	this.displayOrder = d.getInt16(60);

	this.mass = d.getInt16(60);
	this.length = d.getInt16(62);
	this.inherentAI = d.getInt16(64);
	this.crew = d.getInt16(66);
	this.strength = d.getInt16(68);

	this.inherentGovt = d.getInt16(70);
	this.flagsN = d.getInt16(72);



	
	this.podCount = d.getInt16(74);
	this.defaultItems = [];
	for (var i = 0; i < 8 ; i ++){
	    this.defaultItems[i] = {};
	    this.defaultItems[i].id = d.getInt16(76+2*i);
	    this.defaultItems[i].count = d.getInt16(84+2*i);
	}

	this.energyRecharge = d.getInt16(92);
	this.skillVariance = d.getInt16(94);
	this.flags2N = d.getInt16(96);
	
	this.avalibility = d.getInt16(98);
	
	this.appearOn = d.getInt16(100);
	this.onPurchase = d.getInt16(102);
	this.deionize = d.getInt16(104);
	this.ionization = d.getInt16(106);
	this.keyCarried = d.getInt16(108);
/*
	this. = d.getInt16(110);
	this. = d.getInt16(112);
	this. = d.getInt16(114);
	this. = d.getInt16(116);
	this. = d.getInt16(118);

	this. = d.getInt16(110);
	this. = d.getInt16(112);
	this. = d.getInt16(114);
	this. = d.getInt16(116);
	this. = d.getInt16(118);

	this. = d.getInt16(110);
	this. = d.getInt16(112);
	this. = d.getInt16(114);
	this. = d.getInt16(116);
	this. = d.getInt16(118);

*/	

	

    }

};

module.exports = ship;
