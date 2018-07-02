var assert = require('assert');
var chai = require('chai');
var expect = chai.expect;
var resourceFork = require('resourceforkjs').resourceFork;

//var boom = require('../parsers/boom.js');
var boom = require('../parsers/boom.js');
var PNG = require("pngjs").PNG;
var fs = require('fs');
var Promise = require("bluebird");


describe("boom", function() {
    var rf;
    var firstBoom;
    var silentBoom;
    var slowBoom;
    
    before(async function() {
	rf = new resourceFork("./test/files/boom.ndat", false);
	await rf.read();
	var booms = rf.resources.bööm;
	firstBoom = new boom(booms[128]);
	silentBoom = new boom(booms[129]);
	slowBoom = new boom(booms[130]);
    });

    it("should parse animation rate", function() {
	expect(firstBoom.animationRate).to.equal(100);
	expect(silentBoom.animationRate).to.equal(79);
	expect(slowBoom.animationRate).to.equal(23);
    });

    it("should parse sound", function() {
	expect(firstBoom.sound).to.equal(300);
	expect(silentBoom.sound).to.equal(null);
	expect(slowBoom.sound).to.equal(344);

    });
    
    // this is the sprite field
    it("should parse graphic", function() {
	expect(firstBoom.graphic).to.equal(400);
	expect(silentBoom.graphic).to.equal(423);
	expect(slowBoom.graphic).to.equal(412);
    });

});
