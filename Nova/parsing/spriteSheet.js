var PNG = require('pngjs').PNG;
var fs = require("fs");
var convexHullBuilder = require("../server/convexHullBuilder.js");
// maybe move convexHullBuilder to the parsing directory?

var spriteSheet = class {
    constructor(rled) {
	this.id = rled.prefix + ":" + rled.id;
	this.frames = rled.frames;
	this.frameCount = this.frames.length;
	this.width = this.frames.length * this.frames[0].width;
	this.height = this.frames[0].height;
	this.frameWidth = this.frames[0].width;
	this.frameHeight = this.frames[0].height;
	this._convexHulls = null;
	this._png = null;
	    
	// make the frame metadata
	this.frameInfo = {};
	this.frameInfo.frames = {};
	for (var f = 0; f < this.frames.length; f++) {
	    this.frameInfo.frames[this.id + " " + f + ".png"] = {
		frame: {
		    x:f * this.frameWidth,
		    y:0,
		    w:this.frameWidth,
		    h:this.frameHeight
		},
		rotated: false,
		trimmed: false,
		sourceSize: {w: this.width, h: this.height}
	    };
	}
	    
	    
	this.frameInfo.meta = {
	    format: "RGBA8888",
	    size: {
		w: this.width,
		h: this.height
	    },
	    scale:'1',
	    image: './image.png'
	    // imagePurposes: {
	    // 	// default uses all frames as normal animation frames. Shan changes this
	    // 	normal: {
	    // 	    start:0,
	    // 	    length:this.frameCount
	    // 	}
	    // }
	};


    }

    get png() {
	// for just in time processing
	if (!this._png) {
	    this._png = new PNG({
		filtertype:4,
		width:this.width,
		height:this.height
	    });

	    // copy the frames into this._png	
	    for (var f = 0; f < this.frames.length; f++) {
		var frame = this.frames[f];

		for (var y = 0; y < frame.height; y++) {
		    for (var x = 0; x < frame.width; x++) {
			var frameIDX = (frame.width * y + x) << 2;
			var pngIDX = (this._png.width * y + frame.width * f + x) << 2;

			this._png.data[pngIDX] = frame.data[frameIDX];
			this._png.data[pngIDX + 1] = frame.data[frameIDX + 1];
			this._png.data[pngIDX + 2] = frame.data[frameIDX + 2];
			this._png.data[pngIDX + 3] = frame.data[frameIDX + 3];
			// is there a better way?
		    }
		}
	    }
	}

	return this._png;
    }
    
    get convexHulls() {
	// for just in time processing
	if (!this._convexHulls) {
	    this._convexHulls = new convexHullBuilder(this.png, this.frameInfo.frames)
		.buildFromSpriteSheet();
	}
	return this._convexHulls;
    }
    
    // for debugging
    write(path) {
	return new Promise(function(fulfill, reject) {
	    this.png.pack().pipe(fs.createWriteStream(path))
		.on('finish', fulfill);
	}.bind(this));
    }
    
    

};

module.exports = spriteSheet;
