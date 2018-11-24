var assert = require('assert');
var chai = require('chai');
var expect = chai.expect;
var resourceFork = require('resourceforkjs').resourceFork;

var rled = require('../parsers/rled.js');

var PNG = require("pngjs").PNG;
var fs = require('fs');
var Promise = require("bluebird");

describe("rled", function() {

    var starbridge;
    var leviathan;
    var starbridgePNG;
    var starbridgeMask;
    var leviathanPNG;
    var leviathanMask;
    
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

    let getFrames = function(png, dim) {


	// dim is dim of each frame;
	assert.equal(png.height % dim.height, 0);
	assert.equal(png.width % dim.width, 0);

	var out = [];

	for (var y = 0; y < png.height; y += dim.height) {
	    for (var x = 0; x < png.width; x += dim.width) {
		var outPNG = new PNG({filtertype:4, width:dim.width, height:dim.height});

		for (var xi = 0; xi < dim.width; xi++) {
		    for (var yi = 0; yi < dim.height; yi++) {
			var outidx = (outPNG.width * yi + xi) << 2;
			var sourceidx = (png.width * (y + yi) + x + xi) << 2;
			outPNG.data[outidx] = png.data[sourceidx];
			outPNG.data[outidx+1] = png.data[sourceidx+1];
			outPNG.data[outidx+2] = png.data[sourceidx+2];
			outPNG.data[outidx+3] = png.data[sourceidx+3];
		    }
		}

		out.push(outPNG);
	    }
	}
	return out;

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

    let applyMask = function(image, mask) {
	assert.equal(image.width, mask.width);
	assert.equal(image.height, mask.height);

	var out = new PNG({
	    filterType:4,
	    width: image.width,
	    height: image.height	    
	});
	image.data.copy(out.data, 0, 0, image.data.length); // copy image to out
	
	for (var y = 0; y < image.height; y++) {
            for (var x = 0; x < image.width; x++) {
                var idx = (image.width * y + x) << 2;

		if ((mask.data[idx] === 0) && 
		    (mask.data[idx + 1] === 0) &&
		    (mask.data[idx + 2] === 0)) {

		    // change out's alpha to clear wherever mask is black
		    out.data[idx + 3] = 0;
		}
		else {
		    // alpha is opaque everywhere else
		    out.data[idx + 3] = 255;
		}
            }
	}

	return out;
    };
    
    before(async function() {
	this.timeout(10000); // 10 secs to read all the files
	// could be faster with Promise.all
	starbridgePNG = await getPNG("./test/files/rleds/starbridge.png");
	starbridgeMask = await getPNG("./test/files/rleds/starbridge_mask.png");
	leviathanPNG = await getPNG("./test/files/rleds/leviathan.png");
	leviathanMask = await getPNG("./test/files/rleds/leviathan_mask.png");

	rf = new resourceFork("./test/files/rled.ndat", false);
	await rf.read();

	var rleds = rf.resources.rlëD;
	starbridge = new rled(rleds[1010]);
	leviathan = new rled(rleds[1006]);
    });


    it("should parse resource name", function() {
	assert.equal(leviathan.name, "Leviathan");
	assert.equal(starbridge.name, "");
    });

    it("should parse resource id", function() {
	assert.equal(leviathan.id, 1006);
	assert.equal(starbridge.id, 1010);
    });

    /*
    it("should parse the images", function() {
	comparePNGs(starbridge.rawImage, starbridgePNG);
	comparePNGs(leviathan.rawImage, leviathanPNG);
    });

    it("should parse the masks", function() {
	comparePNGs(starbridge.mask, starbridgeMask);
	comparePNGs(leviathan.mask, leviathanMask);
    });
    */

    it("comparePNGs should work for the same picture", function() {
	comparePNGs(starbridgePNG, starbridgePNG);
    });

    it("comparePNG should work for different pictures", function() {
	expect(function() {
	    comparePNGs(starbridgePNG, starbridgeMask);
	}).to.throw();
	
    });


    it("getFrames should work", async function() {

	var starbridgeFrames = getFrames(starbridgePNG, {width:48, height:48});

	var pngs = [];
	var promises = [];
	for (var i = 0; i < 108; i++) {
	    var path = "./test/files/rleds/testFrames/" + "starbridge" + i + ".png";
	    promises.push(async function() {
		var index = i;
		pngs[index] = await getPNG(path);
	    }());
	}

	await Promise.all(promises);

	for (var i = 0; i < 108; i++) {
	    comparePNGs(pngs[i], starbridgeFrames[i]);
	}
	
    });
    
    it("should produce an ordered array of frames", async function() {

	var starbridgeApplied = applyMask(starbridgePNG, starbridgeMask);
	var leviathanApplied = applyMask(leviathanPNG, leviathanMask);

	var starbridgeFrames = getFrames(starbridgeApplied, {width:48, height:48});
	var leviathanFrames = getFrames(leviathanApplied, {width:144, height:144});

	assert.equal(starbridge.frames.length, starbridgeFrames.length);
	assert.equal(leviathan.frames.length, leviathanFrames.length);

	for (var i = 0; i < starbridge.frames.length; i++) {
	    comparePNGs(starbridgeFrames[i], starbridge.frames[i]);
	}

	for (var i = 0; i < leviathan.frames.length; i++) {
	    comparePNGs(leviathanFrames[i], leviathan.frames[i]);
	}


/*
	var promises = starbridgeFrames.map(function(image, index) {
	    return new Promise(function(fulfill, reject) {
		image.pack().pipe(fs.createWriteStream(")
				  .on('finish', function() {
				      fulfill();
				  }));

	    });
	});

	await Promise.all(promises);
*/	
	/*
	// cheapo testing of applyMask
	leviathan_masked.pack().pipe(fs.createWriteStream("./test/files/rleds/testWriting.png")
				  .on('finish', function() {
				      done();
				  }));
	*/
	

    });

});
