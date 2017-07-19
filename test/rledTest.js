var assert = require('assert');
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

    let comparePNGs = function(png1, png2) {
	assert(png1 instanceof PNG);
	assert(png2 instanceof PNG);
	assert.equal(png1.width, png2.width);
	assert.equal(png1.height, png2.height);
	assert.equal(png1.gamma, png2.gamma);
	assert(png1.buffer.equals(png2.buffer));
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
	starbridge = rled(rleds[1010]);
	leviathan = rled(rleds[1006]);
    });


    it("should parse resource name", function() {
	assert.equal(leviathan.name, "Leviathan");
	assert.equal(starbridge.name, "");
    });

    it("should parse resource id", function() {
	assert.equal(leviathan.id, 1006);
	assert.equal(starbridge.id, 1010);
    });

    
    it("should parse the images", function() {
	comparePNGs(starbridge.rawImage, starbridgePNG);
	comparePNGs(leviathan.rawImage, leviathanPNG);
    });

    it("should parse the masks", function() {
	comparePNGs(starbridge.mask, starbridgeMask);
	comparePNGs(leviathan.mask, leviathanMask);
    });

    it("should combine the image and mask to make a new image with alpha", function() {
	var starbridge_masked = applyMask(starbridgePNG, starbridgeMask);
	var leviathan_masked = applyMask(leviathanPNG, leviathanMask);

	comparePNGs(starbridge.image, starbridge_masked);
	comparePNGs(leviathan.image, leviathanMasked);
	
	/*
	// cheapo testing of applyMask
	leviathan_masked.pack().pipe(fs.createWriteStream("./test/files/rleds/testWriting.png")
				  .on('finish', function() {
				      done();
				  }));
	*/
	

    });

});
