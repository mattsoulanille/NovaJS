var assert = require('assert');
var resourceFork = require('resourceforkjs').resourceFork;

var weap = require('../parsers/weap.js');


describe("weap", function() {
    var rf;
    var unguided;
    var beam;
    var missile;
    var turret;
    before(function(done) {
	rf = new resourceFork("./test/files/weap.ndat", false);
	rf.read().then(function() {
	    var weaps = rf.resources.wëap;
	    unguided = weap(weaps[128]);
	    beam = weap(weaps[129]);
	    missile = weap(weaps[130]);
	    turret = weap(weaps[131]);
	    done();
	}.bind(this));
    });

    it("should produce an output", function() {
	assert(! (typeof unguided === 'undefined') );
    });

    it("should parse shield damage", function() {
	assert.equal(unguided.shieldDamage, 11);
	assert.equal(beam.shieldDamage, 111);
	assert.equal(missile.shieldDamage, 1);
	assert.equal(turret.shieldDamage, 32767);
    });

    it("should parse armor damage", function() {
	assert.equal(unguided.armorDamage, 12);
	assert.equal(beam.armorDamage, 112);
	assert.equal(missile.armorDamage, 2);
	assert.equal(turret.armorDamage, 32767);
    });

    it("should parse impact", function() {
	assert.equal(unguided.impact, 13);
	assert.equal(beam.impact, 113);
	assert.equal(missile.impact, 3);
	assert.equal(turret.impact, 32767);
    });

    it("should parse recoil", function() {
	assert.equal(unguided.recoil, 14);
	assert.equal(beam.recoil, 114);
	assert.equal(missile.recoil, 4);
	assert.equal(turret.recoil, 32767);
    });

    it("should parse decay", function() {
	assert.equal(unguided.decay, 15);
	assert.equal(beam.decay, 115);
	assert.equal(missile.decay, 5);
	assert.equal(turret.decay, 32767);
    });

    it("should parse reload time", function() {
	assert.equal(unguided.reload, 16);
	assert.equal(beam.reload, 116);
	assert.equal(missile.reload, 6);
	assert.equal(turret.reload, 32767);
    });

    it("should parse shot speed", function() {
	assert.equal(unguided.speed, 17);
	assert.equal(beam.speed, 117); // is this applicable
	assert.equal(missile.speed, 7);
	assert.equal(turret.speed, 32767);
    });

    it("should parse duration", function() {
	assert.equal(unguided.duration, 18);
	assert.equal(beam.duration, 118);
	assert.equal(missile.duration, 8);
	assert.equal(turret.duration, 32767);
    });

    it("should parse guidance", function() {
	assert.equal(unguided.guidance, "unguided");
	assert.equal(beam.guidance, "beam");
	assert.equal(missile.guidance, "guided");
	assert.equal(turret.guidance, "turret");
    });

    it("should parse turn rate", function() {
	assert.equal(missile.turnRate, 9);
    });
       
    it("should parse accuracy", function() {
	assert.equal(unguided.accuracy, 19); 
	assert.equal(beam.accuracy, 0);
	assert.equal(missile.accuracy, 10);
	assert.equal(turret.accuracy, 360);
    });

    it("should parse fireAtFixedAngle", function() {
	assert.equal(unguided.firesAtFixedAngle, false); 
	assert.equal(beam.firesAtFixedAngle, false);
	assert.equal(missile.firesAtFixedAngle, true);
	assert.equal(turret.firesAtFixedAngle, false);
	
    });

    it("should parse AmmoType", function() {
	assert.equal(unguided.ammoType, -1);
	assert.equal(beam.ammoType, -1);
	assert.equal(missile.ammoType, 130);
	assert.equal(turret.ammoType, 383);
    });

    it("should parse graphic", function() {
	assert.equal(unguided.graphic, 3255);
	assert.equal(beam.graphic, -1);
	assert.equal(missile.graphic, 3244);
	assert.equal(turret.graphic, 3001);
    });

    it("should parse sound", function() {
	assert.equal(unguided.sound, 221);
	assert.equal(beam.sound, -1);
	assert.equal(missile.sound, 212);
	assert.equal(turret.sound, 263);
    });

    it("should parse explosion", function() {
	assert.equal(unguided.explosion, 147);
	assert.equal(beam.explosion, -1);
	assert.equal(missile.explosion, 138);
	assert.equal(turret.explosion, 191);
    });

    it("should parse explosion128sparks", function() {
	assert.equal(unguided.explosion128sparks, false);
	//assert.equal(beam.explosion128sparks, -1);
	assert.equal(missile.explosion128sparks, true);
	assert.equal(turret.explosion128sparks, true);
	
    });

    it("should parse proxRadius", function() {
	assert.equal(unguided.proxRadius, 49);
	//assert.equal(beam.proxRadius, 0);
	assert.equal(missile.proxRadius, 40);
	assert.equal(turret.proxRadius, 32767);
    });

    it("should parse blastRadius", function() {
	assert.equal(unguided.blastRadius, 48);
	//assert.equal(beam.blastRadius, 0);
	assert.equal(missile.blastRadius, 39);
	assert.equal(turret.blastRadius, 32767);
    });

    it("should parse spinShots", function() {
	assert.equal(unguided.spinShots, false);
	//assert.equal(beam.spinShots, 0);
	assert.equal(missile.spinShots, true);
	assert.equal(turret.spinShots, true);
    });

    // see nova bible beamWidth
    it("should parse spinRate", function() {
	assert.equal(missile.spinRate, 123);
	assert.equal(turret.spinRate, 221);
    });

    it("should parse primary/secondary", function() {
	assert.equal(unguided.fireGroup, "primary"); 
	assert.equal(beam.fireGroup, "primary");
	assert.equal(missile.fireGroup, "secondary");	
	assert.equal(turret.fireGroup, "primary");
    });


    it("should parse startSpinningOnFirstFrame", function() {
	//assert.equal(unguided.startSpinningOnFirstFrame, false);
	//assert.equal(beam.startSpinningOnFirstFrame, 0);
	assert.equal(missile.startSpinningOnFirstFrame, true);
	assert.equal(turret.startSpinningOnFirstFrame, false);
    });

    it("should parse dontFireAtFastShips", function() {
	assert.equal(missile.dontFireAtFastShips, true);
    });

    it("should parse loopSound", function() {
	assert.equal(unguided.loopSound, false); 
	//assert.equal(beam.loopSound, "primary");
	assert.equal(missile.loopSound, true);
	assert.equal(turret.loopSound, false);
    });


    // these next tests need more test cases
    it("should parse passThroughShields", function() {
	assert.equal(unguided.passThroughShields, false); 
	assert.equal(beam.passThroughShields, true);
	assert.equal(missile.passThroughShields, false);
	assert.equal(turret.passThroughShields, true);
    });

    it("should parse fireSimultaneously", function() {
	assert.equal(unguided.fireSimultaneously, false); 
	assert.equal(beam.fireSimultaneously, true);
	assert.equal(missile.fireSimultaneously, false);
	assert.equal(turret.fireSimultaneously, true);
    });

    it("should parse vulnerableToPD", function() {
	assert.equal(missile.vulnerableToPD, true);
    });

    it("should parse hitsFiringShip", function() {
	assert.equal(unguided.hitsFiringShip, true); 
	//assert.equal(beam.hitsFiringShip, true);
	assert.equal(missile.hitsFiringShip, false);
	assert.equal(turret.hitsFiringShip, true);
    });

    it("should parse smallCicnSmoke", function() {
	assert.equal(unguided.smallCicnSmoke, false); 
	//assert.equal(beam.smallCicnSmoke, false);
	assert.equal(missile.smallCicnSmoke, false);
	assert.equal(turret.smallCicnSmoke, true);
    });

    it("should parse bigCicnSmoke", function() {
	assert.equal(unguided.bigCicnSmoke, false); 
	//assert.equal(beam.bigCicnSmoke, false);
	assert.equal(missile.bigCicnSmoke, true);
	assert.equal(turret.bigCicnSmoke, false);
    });

    it("should parse persistentCicnSmoke", function() {
	assert.equal(unguided.persistentCicnSmoke, false);
	//assert.equal(beam.persistentCicnSmoke, false);
	assert.equal(missile.persistentCicnSmoke, false);
	assert.equal(turret.persistentCicnSmoke, true);
    });

    it("should parse turretBlindSpots", function() {
	var blindSpots = turret.turretBlindSpots;
	assert.equal(blindSpots.front, false);
	assert.equal(blindSpots.side, true);
	assert.equal(blindSpots.back, false);
    });
    
    it("should parse flak", function() {
	assert.equal(unguided.flak, false);
	//assert.equal(beam.flak, false);
	assert.equal(missile.flak, true);
	assert.equal(turret.flak, false);
    });

    it("should parse passOverAsteroids", function() {
	assert.equal(unguided.passOverAsteroids, false);
	//assert.equal(beam.passOverAsteroids, false);
	assert.equal(missile.passOverAsteroids, true);
	assert.equal(turret.passOverAsteroids, true);
    });

    it("should parse decoyedByAsteroids", function() {
	//assert.equal(unguided.decoyedByAsteroids, false);
	//assert.equal(beam.decoyedByAsteroids, false);
	assert.equal(missile.decoyedByAsteroids, true);
	//assert.equal(turret.decoyedByAsteroids, false);
    });

    it("should parse confusedByInterference", function() {
	assert.equal(missile.confusedByInterference, true);
    });

    it("should parse turnsAwayIfJammed", function() {
	assert.equal(missile.turnsAwayIfJammed, true);
    });

    it("should parse cantFireWhileIonized", function() {
	assert.equal(unguided.cantFireWhileIonized, false);
	assert.equal(beam.cantFireWhileIonized, true);
	assert.equal(missile.cantFireWhileIonized, true);
	assert.equal(turret.cantFireWhileIonized, false);
    });

    it("should parse loseLockIfNotAhead", function() {
	assert.equal(missile.loseLockIfNotAhead, true);
    });

    it("should parse attackParentIfJammed", function() {
	assert.equal(missile.attackParentIfJammed, true);
    });
        
    it("should parse cicnSmoke", function() {
	assert.equal(unguided.cicnSmoke, false);
	assert.equal(beam.cicnSmoke, false);

	var missileCicns = [1000,1001,1002,1003,1004,1005,1006,1007];
	var turretCicns = [1008,1009,1010,1011,1012,1013,1014,1015];
	
	for (var i = 0; i < 8; i++) {
	    assert.equal(missile.cicnSmoke[i], missileCicns[i]);
	    assert.equal(turret.cicnSmoke[i], turretCicns[i]);
	};
    });

    it("should parse decay", function() {	
	assert.equal(unguided.decay, 15);
	assert.equal(beam.decay, 115);
	assert.equal(missile.decay, 5);
	assert.equal(turret.decay, 32767);
    });

    it("should parse trailParticles number", function() {
	assert.equal(unguided.trailParticles.number, 34);
	assert.equal(beam.trailParticles.number, -1);
	assert.equal(missile.trailParticles.number, 25);
	assert.equal(turret.trailParticles.number, 32767);
    });

    it("should parse trailParticles lifeMin", function() {
	assert.equal(unguided.trailParticles.lifeMin, 35);
	assert.equal(beam.trailParticles.lifeMin, -1);
	assert.equal(missile.trailParticles.lifeMin, 26);
	assert.equal(turret.trailParticles.lifeMin, 32767);
    });

    it("should parse trailParticles lifeMax", function() {
	assert.equal(unguided.trailParticles.lifeMax, 40);
	assert.equal(beam.trailParticles.lifeMax, -1);
	assert.equal(missile.trailParticles.lifeMax, 31);
	assert.equal(turret.trailParticles.lifeMax, 32767);
    });


    it("should parse trailParticles color", function() {
	assert.equal(unguided.trailParticles.color, 0xFF242526);
	assert.equal(beam.trailParticles.color, 0xFF000000);
	assert.equal(missile.trailParticles.color, 0xFF1B1C1D);
	assert.equal(turret.trailParticles.color, 0xFFFFFFFF);
    });

    it("should parse trailParticles color", function() {
	assert.equal(unguided.trailParticles.color, 0xFF242526);
	assert.equal(beam.trailParticles.color, 0xFF000000);
	assert.equal(missile.trailParticles.color, 0xFF1B1C1D);
	assert.equal(turret.trailParticles.color, 0xFFFFFFFF);
    });

    it("should parse beamLength", function() {
	assert.equal(beam.beamLength, 19);
    });

    it("should parse beamWidth", function() {
	assert.equal(beam.beamWidth, 20);
    });

    it("should parse coronaFalloff", function() {
	assert.equal(beam.coronaFalloff, 24);
    });

    it("should parse beamColor", function() {
	assert.equal(beam.beamColor, 0xFF151617);
    });

    it("should parse coronaColor", function() {
	assert.equal(beam.coronaColor, 0xFF191A1B);
    });

    it("should parse submunitions count", function() {
	assert.equal(unguided.submunitions[0].count, 25);
	assert.equal(missile.submunitions[0].count, 16);
	assert.equal(turret.submunitions[0].count, 32767);
    });

    it("should parse submunitions type", function() {
	assert.equal(unguided.submunitions[0].type, 226);
	assert(typeof beam.submunitions[0] === 'undefined');
	assert.equal(missile.submunitions[0].type, 217);
	assert.equal(turret.submunitions[0].type, 130);
    });

    it("should parse submunitions theta", function() {
	assert.equal(unguided.submunitions[0].theta, 27);
	assert.equal(missile.submunitions[0].theta, -18);
	assert.equal(turret.submunitions[0].theta, 32767);
    });

    it("should parse submunitions limit", function() {
	assert.equal(unguided.submunitions[0].limit, 28);
	assert.equal(missile.submunitions[0].limit, 19);
	assert.equal(turret.submunitions[0].limit, 32767);
    });


    it("should parse proxSafety", function() {
	assert.equal(unguided.proxSafety, 50);
	assert.equal(missile.proxSafety, 41);
	assert.equal(turret.proxSafety, 32767);
    });

//    it("should parse spin
    
});
