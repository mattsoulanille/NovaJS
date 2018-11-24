var chai = require("chai");
var expect = chai.expect;
var assert = chai.assert;

var resourceFork = require('resourceforkjs').resourceFork;

var syst = require("../parsers/syst.js");

describe("syst", function() {

    var s1;
    var s2;
    
    before(async function() {
	var rf = new resourceFork("./test/files/syst.ndat", false);
	await rf.read();

	var systs = rf.resources.sÿst;
	s1 = new syst(systs[128]);
	s2 = new syst(systs[129]);
    });


    it("should parse position", function() {
	expect(s1.position).to.deep.equal([42,84]);
	expect(s2.position).to.deep.equal([-28,-96]);
    });

    it("should parse links", function() {
	expect(s1.links).to.deep.equal(new Set([129, 163]));
	expect(s2.links).to.deep.equal(new Set([128, 163]));
    });

    it("should parse spobs", function() {
	expect(s1.spobs).to.deep.equal([128, 189, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 194]);
    });
});
