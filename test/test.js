var assert = require('assert');
var resourceFork = require('resourceforkjs').resourceFork;

var weap = require('../parsers/weap.js');


describe("weap", function() {
    var rf;
    var unguided;
    var beam;
    var missile;
    before(function(done) {
	rf = new resourceFork("./test/files/weap.ndat", false);
	rf.read().then(function() {
	    var weaps = rf.resources.wëap;
	    unguided = weap(weaps[128]);
	    beam = weap(weaps[129]);
	    missile = weap(weaps[130]);
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
    });

    it("should parse armor damage", function() {
	assert.equal(unguided.armorDamage, 12);
	assert.equal(beam.armorDamage, 112);
	assert.equal(missile.armorDamage, 2);
    });

    it("should parse impact", function() {
	assert.equal(unguided.impact, 13);
	assert.equal(beam.impact, 113);
	assert.equal(missile.impact, 3);
    });

    it("should parse recoil", function() {
	assert.equal(unguided.recoil, 14);
	assert.equal(beam.recoil, 114);
	assert.equal(missile.recoil, 4);
    });

    it("should parse decay", function() {
	assert.equal(unguided.recoil, 15);
	assert.equal(beam.recoil, 115);
	assert.equal(missile.recoil, 5);
    });

    it("should parse reload time", function() {
	assert.equal(unguided.reload, 16);
	assert.equal(beam.reload, 116);
	assert.equal(missile.reload, 6);
    });

    it("should parse shot speed", function() {
	assert.equal(unguided.speed, 17);
	assert.equal(beam.speed, 117); // is this applicable
	assert.equal(missile.speed, 7);
    });

    it("should parse duration", function() {
	assert.equal(unguided.duration, 18);
	assert.equal(beam.duration, 118);
	assert.equal(missile.duration, 8);
    });

    it("should parse guidance", function() {
	assert.equal(unguided.guidance, "unguided");
	assert.equal(beam.guidance, "beam");
	assert.equal(missile.guidance, "guided");
    });

    it("should parse turn rate", function() {
	assert.equal(missile.turnRate, 9);
    });
       
    it("should parse accuracy", function() {
	assert.equal(unguided.accuracy, 19); 
	assert.equal(beam.accuracy, 0);
	assert.equal(missile.accuracy, 10);	
    });

    it("should parse primary/secondary", function() {
	assert.equal(unguided.fireGroup, "primary"); 
	assert.equal(beam.fireGroup, "primary");
	assert.equal(missile.fireGroup, "secondary");	
    });

    it("should parse AmmoType", function() {
	assert.equal(unguided.ammoType, -1);
	assert.equal(beam.ammoType, -1);
	assert.equal(missile.ammoType, 130);
    });

});
