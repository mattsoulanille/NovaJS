var PNG = require('pngjs').PNG;
var fs = require("fs");


var spriteSheet = class {
    constructor(rled) {
	this.id = rled.prefix + ":" + rled.id;
	this.frames = rled.frames;
	this.frameCount = this.frames.length;
	this.width = this.frames.length * this.frames[0].width;
	this.height = this.frames[0].height;
	this.frameWidth = this.frames[0].width;
	this.frameHeight = this.frames[0].height;


	this.png = new PNG({
	    filtertype:4,
	    width:this.width,
	    height:this.height
	});




	// make the frame metadata
	this.frameInfo = {};
	this.frameInfo.frames = {};

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

	// copy the frames into this.png	
	for (var f = 0; f < this.frames.length; f++) {
	    var frame = this.frames[f];

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
	    

	    
	    for (var y = 0; y < frame.height; y++) {
		for (var x = 0; x < frame.width; x++) {
		    var frameIDX = (frame.width * y + x) << 2;
		    var pngIDX = (this.png.width * y + frame.width * f + x) << 2;

		    this.png.data[pngIDX] = frame.data[frameIDX];
		    this.png.data[pngIDX + 1] = frame.data[frameIDX + 1];
		    this.png.data[pngIDX + 2] = frame.data[frameIDX + 2];
		    this.png.data[pngIDX + 3] = frame.data[frameIDX + 3];
		    // is there a better way?
		}
	    }
	}

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
