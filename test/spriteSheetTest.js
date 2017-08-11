var chai = require("chai");
var expect = chai.expect;
var assert = chai.assert;

var novaParse = require("novaParse");
var spriteSheet = require("../parsing/spriteSheet.js");

describe("spriteSheet", function() {

    var shuttleBase;
    var radarMissile;
    this.timeout(10000);
    before(async function() {

	var np = new novaParse("./Nova\ Data");
	await np.read();
	shuttleBase = new spriteSheet(np.ids.resources.rlëD['nova:1000']);
	radarMissile = new spriteSheet(np.ids.resources.rlëD['nova:208']);

    });



    it("should parse frameCount", function() {
	expect(shuttleBase.frameCount).to.equal(108);
	expect(radarMissile.frameCount).to.equal(36);
    });
/*
    it("should create an object that describes where each frame is in the sprite sheet", function() {
	expect(shuttleBase.frameInfo.frames).to.deep.equal(


    });
*/
});
