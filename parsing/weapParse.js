var baseParse = require("./baseParse.js");
var explosionParse = require("./explosionParse.js");

var weapParse = class extends baseParse {
    constructor() {
	super(...arguments);
    }

    async parse(weap) {
	var out = await super.parse(weap);

	out.type = weap.guidance;
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
	out.animation = {};
	if (spinGuidances.includes(out.type)) {
	    var spin = weap.idSpace.spïn[weap.graphic];
	    // assumes rleD
	    
	    var rled = spin.idSpace.rlëD[spin.spriteID];
	    out.animation.images = {
		baseImage: {
		    id: rled.prefix + ":" + rled.id
		}
	    };
	}
	else if (beamGuidances.includes(out.type)) {
	    out.animation.beamLength = weap.beamLength;
	    out.animation.beamWidth = weap.beamWidth;
	    out.animation.beamColor = weap.beamColor;
	    out.animation.coronaColor = weap.coronaColor;
	    out.animation.coronaFalloff = weap.coronaFalloff;	    
	}
	else if (out.type === "bay") {
	    // set ship type here
	}

	out.passThroughShields = weap.passThroughShields;
	out.shieldDamage = weap.shieldDamage;
	out.armorDamage = weap.armorDamage;
	out.ionizationDamage = weap.ionization;
	out.ionizationColor = weap.ionizeColor;
	out.reload = weap.reload;
	out.duration = weap.duration;
	out.speed = weap.speed;
	out.turnRate = weap.turnRate;
	out.fireGroup = weap.fireGroup; // primary or secondary
	if (out.type == "point defense" || out.type == "point defense beam") {
	    out.fireGroup = null;
	}
	
	out.exitType = weap.exitType;
	out.accuracy = weap.accuracy;
	out.impact = weap.impact; // knockback force
	out.burstCount = weap.burstCount;
	out.burstReload = weap.burstReload;

	out.shield = 0;
	out.armor = weap.durability;

	out.trailParticles = weap.trailParticles;
	out.hitParticles = weap.hitParticles;
	
	out.maxAmmo = weap.maxAmmo;

	out.useFiringAnimation = weap.useFiringAnimation;
	out.destroyShipWhenFiring = false;
	out.energyCost = 0;
	out.ammoType = "unlimited"; // unlimited ammo
	out.fireSimultaneously = weap.fireSimultaneously;

	// change me when you implement sound.
	if (weap.explosion >= 128) {
	    var boom = weap.idSpace.bööm[weap.explosion];
	    out.explosion = new explosionParse(boom);
	}
	else {
	    out.explosion = null;
	}

	if (weap.explosion128sparks) {
	    var extraBoom = weap.idSpace.bööm[128];
	    out.secondaryExplosion = new explosionParse(extraBoom);
	}
	else {
	    out.secondaryExplosion = null;
	}

	if (weap.ammoType <= -1000) {
	    // then it costs energy
	    out.energyCost = Math.abs(weap.ammoType + 1000) / 10;
	}
	else if (weap.ammoType === -999) {
	    // ship is destroyed
	    out.destroyShipWhenFiring = true;
	}
	else if (weap.ammoType >= 0) {
	    // uses ammo of id adjusted
	    var adjusted = 128 + weap.ammoType;
	    out.ammoType = weap.prefix + ":" + adjusted;
	}

	out.vulnerableTo = [];
	if (weap.vulnerableToPD && out.type === "guided") {
	    out.vulnerableTo.push("point defense");
	}

	out.submunitions = [];
	if (weap.submunitions[0]) {
	    var subs = Object.assign({}, weap.submunitions[0]);
	    subs.id = weap.idSpace.wëap[subs.type].globalID;
	    subs.type = undefined;
	    out.submunitions.push(subs);
	}



	return out;
	
	
    }

};


module.exports = weapParse;
