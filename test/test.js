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
	assert.equal(guided.vulnerableToPD, true);
    });

    it("should parse hitsFiringShip", function() {
	assert.equal(unguided.hitsFiringShip, true); 
	//assert.equal(beam.hitsFiringShip, true);
	assert.equal(missile.hitsFiringShip, false);
	assert.equal(turret.hitsFiringShip, true);
    });

    

});
