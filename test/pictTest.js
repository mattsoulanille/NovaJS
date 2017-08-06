var assert = require('assert');
var chai = require('chai');
var expect = chai.expect;
var resourceFork = require('resourceforkjs').resourceFork;

var pict = require('../parsers/pict.js');

var PNG = require("pngjs").PNG;
var fs = require('fs');
var Promise = require("bluebird");


describe("pict", function() {
    let getPNG = function(path) {
	return new Promise(function(fulfill, reject) {
	    var pngObj = new PNG({filterType: 4});
	    fs.createReadStream(path)
		.pipe(pngObj)
		.on('parsed', function() {
		    fulfill(pngObj);
		});
	});	
    };


    let comparePNGs = function(png1, png2) {
	assert(png1 instanceof PNG);
	assert(png2 instanceof PNG);
	assert.equal(png1.width, png2.width);
	assert.equal(png1.height, png2.height);
	assert.equal(png1.gamma, png2.gamma);
//	assert(png1.data.equals(png2.data));

	// fuzzy compare
	for (var y = 0; y < png1.height; y++) {
	    for (var x = 0; x < png1.width; x++) {
		var idx = (png1.width * y + x) << 2;

		if ((png1.data[idx + 3] !== 0) || (png2.data[idx + 3]) !== 0) {
		    assert.equal(png1.data[idx] >> 3,  png2.data[idx] >> 3);
		    assert.equal(png1.data[idx + 1] >> 3,  png2.data[idx + 1] >> 3);
		    assert.equal(png1.data[idx + 2] >> 3,  png2.data[idx + 2] >> 3);
		    assert.equal(png1.data[idx + 3],  png2.data[idx + 3]);
		    
		}

	    }
	}
    };


    var ship, landed, statusBar, targetImage;
    var shipPNG, landedPNG, statusBarPNG, targetImagePNG;
    var rf;
    before(async function() {
	this.timeout(10000);
	shipPNG = await getPNG("./test/files/picts/ship.png");
	landedPNG = await getPNG("./test/files/picts/landed.png");
	statusBarPNG = await getPNG("./test/files/picts/statusBar.png");
	targetImagePNG = await getPNG("./test/files/picts/targetImage.png");

	rf = new resourceFork("./test/files/pict.ndat", false);
	await rf.read();

	var picts = rf.resources.PICT;
	ship = new pict(picts[20158]);
	landed = new pict(picts[10034]);
	statusBar = new pict(picts[700]);
	targetImage = new pict(picts[3000]);
    });

    it("should parse pict into a png", function() {
	comparePNGs(ship.png, shipPNG);
	comparePNGs(landed.png, landedPNG);
	comparePNGs(statusBar.png, statusBarPNG);
	comparePNGs(targetImage.png, targetImagePNG);
    });



});
