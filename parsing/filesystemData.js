const gettable = require("../libraries/gettable.js");
const path = require("path");
const fs = require("fs");

class filesystemData {
    constructor(rootPath) {
	this.rootPath = rootPath;

	//this.outfits = new gettable("outfits");
	//this.weapons = new gettable("weapons");
	this.statusBars = new gettable(this.getFunction("statusBars", "json").bind(this));
	this.spriteSheets = new gettable(this.getFunction("spriteSheets", "json").bind(this));
	this.spriteSheetImages = new gettable(this.getFunction("spriteSheetImages", "png").bind(this));
	this.spriteSheetFrames = new gettable(this.getFunction("spriteSheetFrames", "json").bind(this));
	this.targetCorners = new gettable(this.getFunction("targetCorners", "json").bind(this));
	
    }

    getFunction(appendPath, extension) {
	return function(item) {
	    return new Promise(function(fulfill, reject) {
		fs.readFile(path.join(this.rootPath, appendPath, item + "." + extension),
			    function(err, contents) {
				if (err) {
				    reject(err);
				}
				else {
				    fulfill(contents);
				}
			    });
	    }.bind(this));
	};
    }
}

module.exports = filesystemData;
