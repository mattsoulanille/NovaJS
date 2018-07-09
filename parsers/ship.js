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
	this.pictID = this.id - 128 + 5000;
	this.descID = this.id - 128 + 13000;

	//stock weapons
	this.weapons = [];
	for (var i = 0; i < 4 ; i ++){
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
	//weaps is strange, very strange
	for (var i = 4; i < 8 ; i ++){
	    this.weapons[i] = {};
	    this.weapons[i].id = d.getInt16(1742+2*i-8);
	    this.weapons[i].count = d.getInt16(1750+2*i-8);
	    this.weapons[i].ammo = d.getInt16(1758+2*i-8);
	    
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

	this.mass = d.getInt16(62);
	this.length = d.getInt16(64);
	this.inherentAI = d.getInt16(66);
	this.crew = d.getInt16(68);
	this.strength = d.getInt16(70);

	this.inherentGovt = d.getInt16(72);
	this.flagsN = d.getInt16(74);



	
	this.podCount = d.getInt16(76);
	this.outfits = [];
	for (var i = 0; i < 4 ; i ++){
	    this.outfits[i] = {};
	    this.outfits[i].id = d.getInt16(78+2*i);
	    this.outfits[i].count = d.getInt16(86+2*i);
	}

	this.energyRecharge = d.getInt16(94);
	this.skillVariation = d.getInt16(96);
	this.flags2N = d.getInt16(98);


	var getString = function(start,length) {
	    var s = "";
	    for (var i = start; i < start + length; i++) {
		if (0 != d.getUint8(i))
		    s += String.fromCharCode(d.getUint8(i));
	    }
	    return s;
	}

	
	this.availabilityNCB = getString(108,255);
	
	this.appearOn = getString(363,255);
	this.onPurchase = getString(618,255);
	this.deionize = d.getInt16(874);
	this.ionization = d.getInt16(876);
	this.keyCarried = d.getInt16(878);

	for (var i = 0; i < 4 ; i ++){
	    this.outfits[i+4] = {};
	    this.outfits[i+4].id = d.getInt16(880+2*i);
	    this.outfits[i+4].count = d.getInt16(888+2*i);
	}
	this.contribute = [d.getUint32(896),d.getUint32(900)];
	this.require = [d.getUint32(896),d.getUint32(900)];
	this.buyRandom = d.getInt16(904);
	this.hireRandom = d.getInt16(906);
	
	this.onCapture = getString(908,255);
	this.onRetire = getString(1163,255);
	this.subtitle = getString(1766,64);
	this.shortName = getString(1486,64);
	this.commName = getString(1550,32);
	this.longName = getString(1582,132);
	
	this.escourtType = d.getInt16(1829);
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
