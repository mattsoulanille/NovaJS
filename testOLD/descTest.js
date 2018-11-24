var assert = require('assert');
var chai = require('chai');
var expect = chai.expect;
var resourceFork = require('resourceforkjs').resourceFork;

var desc = require('../parsers/desc.js');

var fs = require('fs');
var Promise = require("bluebird");


describe("desc", function() {
    var d1, d2;
    before(async function() {

	rf = new resourceFork("./test/files/desc.ndat", false);
	await rf.read();

	var descs = rf.resources.dësc;
	d1 = new desc(descs[128]);
	d2 = new desc(descs[129]);

    });

    it("Should parse the string in the desc", function() {
	expect(d1.string).to.equal("The first description has one line of text that you can read.");
	expect(d2.string).to.equal("This one has a graphic.");
    });
    it("Should parse graphic", function() {
	expect(d2.graphic).to.equal(4214);
    });
    
    

});
