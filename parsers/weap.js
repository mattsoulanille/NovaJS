"use strict";


var base = require("./base.js");


var weap = class extends base {
    constructor() {
	super(...arguments);

	var d = this.data;

	
	this.reload = d.getInt16(0);
	this.duration = d.getInt16(2);
	this.armorDamage = d.getInt16(4);
	this.shieldDamage = d.getInt16(6);
	
	this.guidanceN = d.getInt16(8);

	switch (this.guidanceN) {
	case -1:
	    this.guidance = 'unguided';
	    break;
	case 0:
	    this.guidance = 'beam';
	    break;
	case 1:
	    this.guidance = 'guided';
	    break;
	case 3:
	    this.guidance = 'beam turret';
	    break;
	case 4:
	    this.guidance = 'turret';
	    break;
	case 5:
	    this.guidance = 'freefall bomb';
	    break;
	case 6:
	    this.guidance = 'rocket';
	    break;
	case 7:
	    this.guidance = 'front quadrant';
	    break;
	case 8:
	    this.guidance = 'rear quadrant';
	    break;
	case 9:
	    this.guidance = 'point defense';
	    break;
	case 10:
	    this.guidance = 'point defense beam';
	    break;
	case 99:
	    this.guidance = 'bay';
	    break;
	}

	var conditionalOffset = function (n,off){
	    if (n >=0){
		return n+off;
	    }else{
		return n;
	    }
	}

	this.speed = d.getInt16(10);

	this.ammoType = d.getInt16(12);


	this.graphic = conditionalOffset(d.getInt16(14),3000);

	this.accuracy = d.getInt16(16);
	this.firesAtFixedAngle = this.accuracy < 0;
	this.accuracy = Math.abs(this.accuracy);

	this.sound = conditionalOffset(d.getInt16(18),200);

	this.impact = d.getInt16(20);

	this.explosion = conditionalOffset(d.getInt16(22),128);
	this.explosion128sparks = this.explosion >= 1128;
	if (this.explosion >= 1128){
	    this.explosion -= 1000;
	}

	this.proxRadius = d.getInt16(24);

	this.blastRadius = d.getInt16(26);

	this.flags = d.getUint16(28);
	//flags
	this.spinShots = (this.flags & 0x1)>0;
	if (this.flags & 0x2){
	    this.fireGroup = "secondary";
	}else{
	    this.fireGroup = "primary";
	}
	this.startSpinningOnFirstFrame = (this.flags & 0x4)>0;
	this.dontFireAtFastShips = (this.flags & 0x8)>0;
	this.loopSound = (this.flags & 0x10)>0;
	this.passThroughShields = (this.flags & 0x20)>0;
	this.fireSimultaneously = (this.flags & 0x40)>0;
	this.vulnerableToPD = (this.flags & 0x80)==0;//NB: inverted
	this.hitsFiringShip = (this.flags & 0x100)==0;//NB: inverted
	this.smallCicnSmoke = (this.flags & 0x200)>0;
	this.bigCicnSmoke = (this.flags & 0x400)>0;
	this.persistentCicnSmoke = (this.flags & 0x800)>0;

	this.turretBlindSpots = {};
	this.turretBlindSpots.front = (this.flags & 0x1000)>0;
	this.turretBlindSpots.side = (this.flags & 0x2000)>0;
	this.turretBlindSpots.back = (this.flags & 0x4000)>0;
	this.flak = (this.flags & 0x8000)>0;
	//endflags

	this.guidedFlags = d.getInt16(30);
	//seeker
	this.passOverAsteroids = (this.guidedFlags & 0x1)>0;
	this.decoyedByAsteroids = (this.guidedFlags & 0x2)>0;
	this.confusedByInterference = (this.guidedFlags & 0x8)>0;
	this.turnsAwayIfJammed = (this.guidedFlags & 0x10)>0;
	this.cantFireWhileIonized = (this.guidedFlags & 0x20)>0;
	this.loseLockIfNotAhead = (this.guidedFlags & 0x4000)>0;
	this.attackParentIfJammed = (this.guidedFlags & 0x8000)>0;
	//endseeker


	this.cicnSmoke = conditionalOffset(d.getInt16(32)*8,1000);
	if (this.cicnSmoke >= 0){
	    var tmp = [];
	    for (var i = this.cicnSmoke; i < this.cicnSmoke+8; i++) {
		tmp.push(i);
	    }
	    this.cicnSmoke = tmp;
	}else{
	    this.cicnSmoke = false;
	}

	this.decay = d.getInt16(34);

	var getColor32 = function(n) {
    /*	c =+ (255-d.getInt8(n))<<24;//a inverted 'cause nova has it as 0
	    c =+ d.getInt8(n+1)<<16;//r
	    c =+ d.getInt8(n+2)<<8;//g
	    c =+ d.getInt8(n+3);//b*/
	    var aCorrection = 0xff000000-d.getInt8(n)*0x02000000;//times 2 bc newa - a = max - 2a when newa = max - a
	    return d.getUint32(n) + aCorrection; // fix alpha
	}

	this.trailParticles = {};
	this.trailParticles.number = d.getInt16(36);
	this.trailParticles.velocity = d.getInt16(38);
	this.trailParticles.lifeMin = d.getInt16(40);
	this.trailParticles.lifeMax = d.getInt16(42);
	this.trailParticles.color = getColor32(44);

	this.beamLength = d.getInt16(48);
	this.beamWidth = d.getInt16(50);
	this.spinRate = d.getInt16(50);
	this.coronaFalloff = d.getInt16(52);
	this.beamColor = getColor32(54);
	this.coronaColor = getColor32(58);
	this.lightningDensity = d.getInt16(110);
	this.lightningAmplitude = d.getInt16(112);


	this.proxSafety = d.getInt16(70);

	this.flags2 = d.getInt16(72);
	//flags2
	this.spinBeforeProxSafety = (this.flags2 & 0x1)==0;// NB: inverted
	this.spinStopOnLastFrame = (this.flags2 & 0x2)>0;
	this.proxIgnoreAsteroids = (this.flags2 & 0x4)>0;
	this.proxHitAll = (this.flags2 & 0x8)>0 || (this.guidance != "guided");

	this.submunitions = [];
	if (d.getInt16(64) >0) {
	    this.submunitions[0] = {};
	    this.submunitions[0].count = d.getInt16(62);
	    this.submunitions[0].type = d.getInt16(64);
	    this.submunitions[0].theta = d.getInt16(66);
	    this.submunitions[0].limit = d.getInt16(68);
	    this.submunitions[0].fireAtNearest = (this.flags2 & 0x10)>0;
	    this.submunitions[0].subIfExpire = (this.flags2 & 0x20)==0;// NB: inverted
	}

	this.showAmmo = (this.flags2 & 0x40)==0;// NB: inverted
	this.fireOnlyIfKeyCarried = (this.flags2 & 0x80)>0;
	this.npcCantUse = (this.flags2 & 0x100)>0;
	this.useFiringAnimation = (this.flags2 & 0x200)>0;
	this.planetType = (this.flags2 & 0x400)>0;
	this.hideIfNoAmmo = (this.flags2 & 0x800)>0;
	this.disableOnly = (this.flags2 & 0x1000)>0;
	this.beamUnderShip = (this.flags2 & 0x2000)>0;
	this.fireWhileCloaked = (this.flags2 & 0x4000)>0;
	this.asteroidMiner = (this.flags2 & 0x8000)>0;
	//endflags2

	this.ionization = d.getInt16(74);

	this.hitParticles = {};
	this.hitParticles.number = d.getInt16(76);
	this.hitParticles.life = d.getInt16(78);
	this.hitParticles.velocity = d.getInt16(80);
	this.hitParticles.color = getColor32(82);

	this.recoil = d.getInt16(86);
	if (this.recoil == -1)
	    this.recoil = 0;

	this.exitTypeN = d.getInt16(88);
	var exitLoc = '';
	switch (this.exitTypeN) {
	case -1:
	    exitLoc = "center";
	    break;
	case 0:
	    exitLoc = "gun";
	    break;
	case 1:
	    exitLoc = "turret";
	    break;
	case 2:
	    exitLoc = "guided";
	    break;
	case 3:
	    exitLoc = "beam";
	    break;
	}

	this.exitType = exitLoc;

	this.burstCount = d.getInt16(90);

	this.burstReload = d.getInt16(92);

	this.jam = {};
	this.jamVuln = [];
	this.jam.IR = d.getInt16(94);
	this.jam.radar = d.getInt16(96);
	this.jam.ethricWake = d.getInt16(98);
	this.jam.gravametric = d.getInt16(100);

	this.jamVuln[0] = this.jam.IR;
	this.jamVuln[1] = this.jam.radar;
	this.jamVuln[2] = this.jam.ethricWake;
	this.jamVuln[3] = this.jam.gravametric;


	this.flags3 = d.getInt16(102);
	//flags3
	this.oneAmmoPerBurst = (this.flags3 & 0x1)>0;
	this.translucent = (this.flags3 & 0x2)>0;
	this.cantFireUntilShotExpires = (this.flags3 & 0x4)>0;
	this.firesFromClosestToTarget = (this.flags3 & 0x10)>0;
	this.exclusive = (this.flags3 & 0x20)>0;
	//endflags3

	this.durability = d.getInt16(104);

	this.turnRate = d.getInt16(106);

	this.maxAmmo = d.getInt16(108);

	//lightning density and amplitude take 110 and 112

	this.ionizeColor = getColor32(114);

	this.count = d.getInt16(118);

    }
}

module.exports = weap;
