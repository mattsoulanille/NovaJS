const PNG = require('pngjs').PNG;
const fs = require("fs");
const convexHullBuilder = require("../server/convexHullBuilder.js");
// maybe move convexHullBuilder to the parsing directory?
const baseParse = require("./baseParse.js");

// number of frames before wrapping one row down
const wrap = 10;

// Returns a parsed spriteSheet (with convex hulls) and the corresponding pict.
class spriteSheetAndImageParse extends baseParse {
    
    constructor() {
	super(...arguments);
    }

    async parse(rled) {
	var out = {};
	out.spriteSheet = super.parse(rled);

	var frames = rled.frames;
	var frameWidth = frames[0].width;
	var frameHeight = frames[0].height;
	var frameCount = frames.length;

	var width;
	if (frameCount < wrap) {
	    width = frames.length * frameWidth;
	}
	else {
	    width = wrap * frameWidth;
	}
	var height = frameHeight * Math.ceil(frameCount / wrap);

	out.frameInfo = this.makeFrameMetadata(frames, frameWidth, frameHeight, width, height, out.spriteSheet.id);

	
	var png = this.buildPNG(frames, frameWidth, frameHeight, width, height);
	
	out.png = PNG.sync.write(png);

	let builder = new convexHullBuilder(png, out.frameInfo.frames);
	out.spriteSheet.convexHulls = await builder.buildFromSpriteSheet();

	return out;
    }

    makeFrameMetadata(frames, frameWidth, frameHeight, width, height, id) {
	// make the frame metadata

	var frameInfo = {};
	frameInfo.frames = {};
	for (var f = 0; f < frames.length; f++) {
	    var col = f % wrap;
	    var row = Math.floor(f / wrap);

	    frameInfo.frames[id + " " + f + ".png"] = {
		frame: {
		    x:col * frameWidth,
		    y:row * frameHeight,
		    w:frameWidth,
		    h:frameHeight
		},
		rotated: false,
		trimmed: false,
		sourceSize: {w: width, h: height}
	    };
	}
	    
	    
	frameInfo.meta = {
	    format: "RGBA8888",
	    size: {
		w: width,
		h: height
	    },
	    scale:'1',
	    image: '../spriteSheetImages/' + id + ".png"
	    // The image for this spriteSheet should be accessable at ../spriteSheetImages/:id
	    // imagePurposes: {
	    // 	// default uses all frames as normal animation frames. Shan changes this
	    // 	normal: {
	    // 	    start:0,
	    // 	    length:frameCount
	    // 	}
	    // }
	};
	return frameInfo;
    }
    
    buildPNG(frames, frameWidth, frameHeight, width, height) {
	var png = new PNG({
		filtertype:4,
		width:width,
		height:height
	    });

	    // copy the frames into png	
	    for (var f = 0; f < frames.length; f++) {
		var frame = frames[f];
		var col = f % wrap;
		var row = Math.floor(f / wrap);


		for (var y = 0; y < frame.height; y++) {
		    for (var x = 0; x < frame.width; x++) {
			var frameIDX = (frame.width * y + x) << 2;

			var pngIDX = (png.width * y +       // skip to next row of pixels
				      
				      png.width *           // skip to next row of frames
				      frameHeight * row +
				      
				      x +                         // skip to next col of pixels
				      frameWidth * col       // skip to next col of frames
				     ) << 2;

			png.data[pngIDX] = frame.data[frameIDX];
			png.data[pngIDX + 1] = frame.data[frameIDX + 1];
			png.data[pngIDX + 2] = frame.data[frameIDX + 2];
			png.data[pngIDX + 3] = frame.data[frameIDX + 3];
			// is there a better way?
		    }
		}
	    }
	return png;
    }


    /*
    // for debugging
    write(path) {
	return new Promise(function(fulfill, reject) {
	    png.pack().pipe(fs.createWriteStream(path))
		.on('finish', fulfill);
	}.bind(this));
    }
    */
    

};

module.exports = spriteSheetAndImageParse;
