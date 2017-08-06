
var weapParse = class {
    constructor(weap) {
	this.id = weap.prefix + ":" + weap.id;
	this.name = weap.name;
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
	    this.animation.images = {
		baseImage: {
		    ID: weap.prefix + ":" + spin.spriteID
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
	this.fireGroup = weap.fireGroup; // primary or secondary
	this.accuracy = weap.accuracy;
	this.impact = weap.impact; // knockback force
	this.burstCount = weap.burstCount;
	this.burstReload = weap.burstReload;

	this.maxAmmo = weap.maxAmmo;

	this.destroyShipWhenFiring = false;
	this.energyCost = 0;
	this.ammoType = "unlimited"; // unlimited ammo

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
	
	
    }

};


module.exports = weapParse;
