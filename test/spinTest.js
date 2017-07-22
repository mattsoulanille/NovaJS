var assert = require('assert');
var resourceFork = require('resourceforkjs').resourceFork;

var spin = require('../parsers/spin.js');


describe("spin", function() {
    var rf;
    var explosion;
    var blaster;

    before(function(done) {
	rf = new resourceFork("./test/files/spin.ndat", false);
	rf.read().then(function() {
	    var spins = rf.resources.spïn;
	    explosion = new spin(spins[412]);
	    blaster = new spin(spins[3000]);
	    done();
	}.bind(this));
    });
    
    it("should parse imageType", function() {
	assert.equal(explosion.imageType, "rled");
	assert.equal(blaster.imageType, "rled");
    });

    it("should parse spriteID", function() {
	assert.equal(explosion.spriteID, 4024);
	assert.equal(blaster.spriteID, 200);
    });

    it("should parse spriteSize", function() {
	assert.equal(explosion.spriteSize[0], 145);
	assert.equal(explosion.spriteSize[1], 145);
	assert.equal(blaster.spriteSize[0], 35);
	assert.equal(blaster.spriteSize[1], 35);
    });

    it("should parse spriteTiles", function() {
	assert.equal(explosion.spriteSize[0], 17);
	assert.equal(explosion.spriteSize[1], 17);
	assert.equal(blaster.spriteSize[0], 6);
	assert.equal(blaster.spriteSize[1], 6);
    });

});
