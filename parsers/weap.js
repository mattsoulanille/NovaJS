"use strict";







var weap = function(resource) {
    var d = resource.data;
    var out = {};
    out.name = resource.name;
    out.id = resource.id;

    out.reload = d.getInt16(0);
    out.duration = d.getInt16(2);
    out.armorDamage = d.getInt16(4);
    out.shieldDamage = d.getInt16(6);

    out.guidanceN = d.getInt16(8);
 
    switch (out.guidanceN) {
    case -1:
	out.guidance = 'unguided';
	break;
    case 0:
	out.guidance = 'beam';
        break;
    case 1:
	out.guidance = 'guided';
        break;
    case 3:
	out.guidance = 'beam turret';
        break;
    case 4:
	out.guidance = 'turret';
        break;
    case 5:
	out.guidance = 'freefall bomb';
        break;
    case 6:
	out.guidance = 'rocket';
        break;
    case 7:
	out.guidance = 'front quadrant';
        break;
    case 8:
	out.guidance = 'rear quadrant';
        break;
    case 9:
	out.guidance = 'point defence';
        break;
    case 10:
	out.guidance = 'point defence beam';
        break;
    case 99:
	out.guidance = 'bay';
        break;
    }

    var conditionalOffset = function (n,off){
	if (n >=0){
	    return n+off;
	}else{
	    return n;
	}
    }
        
    out.speed = d.getInt16(10);

    out.ammoType = conditionalOffset(d.getInt16(12),128);

    
    out.graphic = conditionalOffset(d.getInt16(14),3000);
    
    out.accuracy = d.getInt16(16);
    out.firesAtFixedAngle = out.accuracy < 0;
    out.accuracy = Math.abs(out.accuracy);
    
    out.sound = conditionalOffset(d.getInt16(18),200);

    out.impact = d.getInt16(20);

    out.explosion = conditionalOffset(d.getInt16(22),128);
    out.explosion128sparks = out.explosion >= 1128;
    if (out.explosion >= 1128){
	out.explosion -= 1000;
    }
    
    out.proxRadius = d.getInt16(24);

    out.blastRadius = d.getInt16(26);

    out.flags = d.getUint16(28);
    //flags
    out.spinShots = (out.flags & 0x1)>0;
    if (out.flags & 0x2){
        out.fireGroup = "secondary";
    }else{
	out.fireGroup = "primary";
    }
    out.startSpinningOnFirstFrame = (out.flags & 0x4)>0;
    out.dontFireAtFastShips = (out.flags & 0x8)>0;
    out.loopSound = (out.flags & 0x10)>0;
    out.passThroughShields = (out.flags & 0x20)>0;
    out.fireSimultaneously = (out.flags & 0x40)>0;
    out.vulnerableToPD = (out.flags & 0x80)==0;//NB: inverted
    out.hitsFiringShip = (out.flags & 0x100)==0;//NB: inverted
    out.smallCicnSmoke = (out.flags & 0x200)>0;
    out.bigCicnSmoke = (out.flags & 0x400)>0;
    out.persistentCicnSmoke = (out.flags & 0x800)>0;
    
    out.turretBlindSpots = {};
    out.turretBlindSpots.front = (out.flags & 0x1000)>0;
    out.turretBlindSpots.side = (out.flags & 0x2000)>0;
    out.turretBlindSpots.back = (out.flags & 0x4000)>0;
    out.flak = (out.flags & 0x8000)>0;
    //endflags

    out.guidedFlags = d.getInt16(30);
    //seeker
    out.passOverAsteroids = (out.guidedFlags & 0x1)>0;
    out.decoyedByAsteroids = (out.guidedFlags & 0x2)>0;
    out.confusedByInterference = (out.guidedFlags & 0x8)>0;
    out.turnsAwayIfJammed = (out.guidedFlags & 0x10)>0;
    out.cantFireWhileIonized = (out.guidedFlags & 0x20)>0;
    out.loseLockIfNotAhead = (out.guidedFlags & 0x4000)>0;
    out.attackParentIfJammed = (out.guidedFlags & 0x8000)>0;
    //endseeker

    
    out.cicnSmoke = conditionalOffset(d.getInt16(32)*8,1000);
    if (out.cicnSmoke >= 0){
	var tmp = [];
	for (var i = out.cicnSmoke; i < out.cicnSmoke+8; i++) {
	    tmp.push(i);
	}
	out.cicnSmoke = tmp;
    }else{
	out.cicnSmoke = false;
    }
    
    out.decay = d.getInt16(34);

    var getColor32 = function(n) {
/*	c =+ (255-d.getInt8(n))<<24;//a inverted 'cause nova has it as 0
	c =+ d.getInt8(n+1)<<16;//r
	c =+ d.getInt8(n+2)<<8;//g
	c =+ d.getInt8(n+3);//b*/
	var aCorrection = 0xff000000-d.getInt8(n)*0x02000000;//times 2 bc newa - a = max - 2a when newa = max - a
	return d.getUint32(n) + aCorrection; // fix alpha
    }

    out.trailParticles = {};
    out.trailParticles.number = d.getInt16(36);
    out.trailParticles.velocity = d.getInt16(38);
    out.trailParticles.lifeMin = d.getInt16(40);
    out.trailParticles.lifeMax = d.getInt16(42);
    out.trailParticles.color = getColor32(44);
    
    out.beamLength = d.getInt16(48);
    out.beamWidth = d.getInt16(50);
    out.spinRate = d.getInt16(50);
    out.coronaFalloff = d.getInt16(52);
    out.beamColor = getColor32(54);
    out.coronaColor = getColor32(58);
    out.beamLightningDensity = d.getInt16(110);
    out.beamLightningAmplitude = d.getInt16(112);

    
    out.proxSafety = d.getInt16(70);

    out.flags2 = d.getInt16(72);
    //flags2
    out.spinBeforeProxSafety = (out.flags2 & 0x1)==0;// NB: inverted
    out.spinStopOnLastFrame = (out.flags2 & 0x2)>0;
    out.proxIgnoreAsteroids = (out.flags2 & 0x4)>0;
    out.proxHitAll = (out.flags2 & 0x8)>0 || (out.guidance != "guided");

    out.submunitions = [];
    if (d.getInt16(64) >=0) {
	out.submunitions[0] = {};
	out.submunitions[0].count = d.getInt16(62);
	out.submunitions[0].type = d.getInt16(64);
	out.submunitions[0].theta = d.getInt16(66);
	out.submunitions[0].limit = d.getInt16(68);
	out.submunitions[0].fireAtNearest = (out.flags2 & 0x10)>0;
	out.submunitions[0].subIfExpire = (out.flags2 & 0x20)==0;// NB: inverted
    }

    out.showAmmo = (out.flags2 & 0x40)==0;// NB: inverted
    out.fireOnlyIfKeyCarried = (out.flags2 & 0x80)>0;
    out.npcCantUse = (out.flags2 & 0x100)>0;
    out.useFiringAnimation = (out.flags2 & 0x200)>0;
    out.planetType = (out.flags2 & 0x400)>0;
    out.hideIfNoAmmo = (out.flags2 & 0x800)>0;
    out.disableOnly = (out.flags2 & 0x1000)>0;
    out.beamUnderShip = (out.flags2 & 0x2000)>0;
    out.fireWhileCloaked = (out.flags2 & 0x4000)>0;
    out.asteroidMiner = (out.flags2 & 0x8000)>0;
    //endflags2
    
    out.ionization = d.getInt16(74);

    out.hitParticles = {};
    out.hitParticles.number = d.getInt16(76);
    out.hitParticles.life = d.getInt16(78);
    out.hitParticles.velocity = d.getInt16(80);
    out.hitParticles.color = getColor32(82);

    out.recoil = d.getInt16(86);
    
    out.exitTypeN = d.getInt16(88);
    var exitLoc = '';
    switch (out.exitTypeN) {
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

    out.exitType = exitLoc;
    
    out.burstCount = d.getInt16(90);
    
    out.burstReload = d.getInt16(92);

    out.jam = {};
    out.jamVuln = [];
    out.jam.IR = d.getInt16(94);
    out.jam.radar = d.getInt16(96);
    out.jam.ethricWake = d.getInt16(98);
    out.jam.gravametric = d.getInt16(100);

    out.jamVuln[0] = out.jam.IR;
    out.jamVuln[1] = out.jam.radar;
    out.jamVuln[2] = out.jam.ethricWake;
    out.jamVuln[3] = out.jam.gravametric;

    
    out.flags3 = d.getInt16(102);
    //flags3
    out.oneAmmoPerBurst = (out.flags3 & 0x1)>0;
    out.translucent = (out.flags3 & 0x2)>0;
    out.cantFireUntilShotExpires = (out.flags3 & 0x4)>0;
    out.firesFromClosestToTarget = (out.flags3 & 0x10)>0;
    out.exclusive = (out.flags3 & 0x20)>0;
    //endflags3
    
    out.durability = d.getInt16(104);
    
    out.turnRate = d.getInt16(106);
    
    out.maxAmmo = d.getInt16(108);
    
    //lightning density and amplitude take 110 and 112
    
    out.ionizeColor = getColor32(114);

    out.count = d.getInt16(118);

    out.recoil = d.getInt16(120);

    
    
    return out;
};

module.exports = weap;
