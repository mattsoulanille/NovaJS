var chai = require("chai");
var expect = chai.expect;
var assert = chai.assert;

var resourceFork = require('resourceforkjs').resourceFork;

var outf = require("../parsers/outf.js");

describe("outf", function() {

    var w1;

    before(async function() {
	var rf = new resourceFork("./test/files/outf.ndat", false);
	await rf.read();

	var outfs = rf.resources.oütf;
	w1 = new outf(outfs[128]);

    });

    it("should parse outfit functions", function() {
	expect(w1.functions).to.deep.equal([
	    {"weapon":142}
	]);
    });




});
