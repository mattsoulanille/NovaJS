
var spriteSheet = require("./spriteSheet.js");


var shanParse = class {
    constructor(shan) {
	this.shan = shan;
	this.idSpace = this.shan.idSpace;
	this.spriteSheets = {};
	this.buildInfo = {};
	//this.buildInfo.spriteSheets = {};
	this.buildInfo.images = {};
	this.buildSpriteSheets();
    }

    buildSpriteSheets() {

	var imageNames = ['baseImage', 'altImage', 'glowImage', 'lightImage'];
	for (var index in imageNames) {
	    var imageName = imageNames[index];
	    var imageInfo = this.shan[imageName];
	    
	    if (imageInfo.ID <= 0) { // make sure it actually exists
		continue; //...to the next iteration of the loop
	    }
	    
	    this.buildInfo.images[imageName] = { ID: this.shan.prefix + ":" + imageInfo.ID,
					         imagePurposes: {} };

	    // get the rled from novadata
	    var rled = this.idSpace['rlëD'][imageInfo.ID];

	    var sheet = new spriteSheet(rled);
	    this.spriteSheets[imageName] = sheet;
	    var imagePurposes = this.buildInfo.images[imageName].imagePurposes;
	    
	    imagePurposes.normal = {
		start: 0,
		length: this.shan.framesPer
	    };

	    // assign what extra frames are used for (banking, animation etc)
	    switch (this.shan.flags.extraFramePurpose) {
		
	    case ('banking'):
		imagePurposes.left = {
		    start: this.shan.framesPer,
		    length: this.shan.framesPer
		};
		    
		imagePurposes.right = {
		    start: this.shan.framesPer * 2,
		    length: this.shan.framesPer
		};
		break;
	    case ('animation'):
		imagePurposes.animation = {
		    start: this.shan.framesPer,
		    // the rest of the frames are for animation
		    length: this.shan.framesPer * ( (this.shan[imageName].setCount || this.shan.baseImage.setCount) - 1 )
		};
		break;
	    }


	}

    }
    
};

module.exports = shanParse;
