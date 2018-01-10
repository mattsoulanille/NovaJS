var baseParse = require("./baseParse.js");
var explosionParse = require("./explosionParse.js");

var weapParse = class extends baseParse {
    constructor(weap) {
	super(...arguments);
	this.type = weap.guidance;
	// ones that have spins
	var spinGuidances = [
	    "unguided",
	    "turret",
	    "guided",
	    "freefall bomb",
	    "rocket",
	    "front quadrant",
	    "rear quadrant",
	    "point defense"
	];
	var beamGuidances = ["beam", "beam turret", "point defense beam"];
	this.animation = {};
	if (spinGuidances.includes(this.type)) {
	    var spin = weap.idSpace.spïn[weap.graphic];
	    // assumes rleD
	    
	    var rled = spin.idSpace.rlëD[spin.spriteID];
	    this.animation.images = {
		baseImage: {
		    id: rled.prefix + ":" + rled.id
		}
	    };
	}
	else if (beamGuidances.includes(this.type)) {
	    this.animation.beamLength = weap.beamLength;
	    this.animation.beamWidth = weap.beamWidth;
	    this.animation.beamColor = weap.beamColor;
	}
	else if (this.type === "bay") {
	    // set ship type here
	}


	this.shieldDamage = weap.shieldDamage;
	this.armorDamage = weap.armorDamage;
	this.reload = weap.reload;
	this.duration = weap.duration;
	this.speed = weap.speed;
	this.turnRate = weap.turnRate;
	this.fireGroup = weap.fireGroup; // primary or secondary
	if (this.type == "point defense" || this.type == "point defense beam") {
	    this.fireGroup = null;
	}
	
	this.exitType = weap.exitType;
	this.accuracy = weap.accuracy;
	this.impact = weap.impact; // knockback force
	this.burstCount = weap.burstCount;
	this.burstReload = weap.burstReload;

	this.shield = 0;
	this.armor = weap.durability;

	this.trailParticles = weap.trailParticles;
	this.hitParticles = weap.hitParticles;
	
	this.maxAmmo = weap.maxAmmo;

	this.destroyShipWhenFiring = false;
	this.energyCost = 0;
	this.ammoType = "unlimited"; // unlimited ammo
	this.fireSimultaneously = weap.fireSimultaneously;

	// change me when you implement sound.
	if (weap.explosion >= 128) {
	    var boom = weap.idSpace.bööm[weap.explosion];
	    var spin = boom.idSpace.spïn[boom.graphic];
	    var rled = spin.idSpace.rlëD[spin.spriteID];
	    this.explosion = new explosionParse(boom);
	}
	else {
	    this.explosion = null;
	}



	if (weap.ammoType <= -1000) {
	    // then it costs energy
	    this.energyCost = Math.abs(weap.ammoType + 1000) / 10;
	}
	else if (weap.ammoType === -999) {
	    // ship is destroyed
	    this.destroyShipWhenFiring = true;
	}
	else if (weap.ammoType >= 0) {
	    // uses ammo of id adjusted
	    var adjusted = 128 + weap.ammoType;
	    this.ammoType = weap.prefix + ":" + adjusted;
	}

	this.vulnerableTo = [];
	if (weap.vulnerableToPD && this.type === "guided") {
	    this.vulnerableTo.push("point defense");
	}

	this.submunitions = [];
	if (weap.submunitions[0]) {
	    var subs = Object.assign({}, weap.submunitions[0]);
	    subs.id = weap.idSpace.wëap[subs.type].globalID;
	    subs.type = undefined;
	    this.submunitions.push(subs);
	}



	
	
	
    }

};


module.exports = weapParse;
