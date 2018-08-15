var chai = require("chai");
var expect = chai.expect;
var assert = chai.assert;

var resourceFork = require('resourceforkjs').resourceFork;

var spob = require("../parsers/spob.js");

describe("spob", function() {

    var p1;
    var p2;
    
    before(async function() {
	var rf = new resourceFork("./test/files/spob.ndat", false);
	await rf.read();

	var spobs = rf.resources.spöb;
	p1 = new spob(spobs[128]);
	p2 = new spob(spobs[129]);
    });

    it("should parse position", function() {
	expect(p1.position).to.deep.equal([123, 456]);
	expect(p2.position).to.deep.equal([-321,-42]);
    });

    it("should parse graphic", function() {
	expect(p1.graphic).to.equal(2042);
	expect(p2.graphic).to.equal(2060);
    });
    
    it("should parse government", function() {
	expect(p1.government).to.equal(190);
	expect(p2.government).to.equal(163);

    });

    it("should parse techLevel", function() {
	expect(p1.techLevel).to.equal(72);
	expect(p2.techLevel).to.equal(15000);
    });

    it("should parse landingPictID", function() {
	expect(p1.landingPictID).to.equal(10003);
	expect(p2.landingPictID).to.equal(10042);

    });

    it("should set landingDescID", function() {
	expect(p1.landingDescID).to.equal(128);
	expect(p2.landingDescID).to.equal(129);
    });
    
});
