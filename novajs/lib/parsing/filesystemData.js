const gettable = require("../libraries/gettable.js");
const path = require("path");
const fs = require("fs");
const novaDataTypes = require("./novaDataTypes");


class filesystemData {
    constructor(rootPath) {
	this.rootPath = rootPath;

	//this.outfits = new gettable("outfits");
	//this.weapons = new gettable("weapons");
	this.data = {};
	this.data.StatusBar = new gettable(this.getFunction("StatusBar", "json").bind(this));
	this.data.SpriteSheet = new gettable(this.getFunction("SpriteSheet", "json").bind(this));
	this.data.SpriteSheetImage = new gettable(this.getFunction("SpriteSheetImage", "png").bind(this));
	this.data.SpriteSheetFrames = new gettable(this.getFunction("SpriteSheetFrames", "json").bind(this));
	this.data.TargetCorners = new gettable(this.getFunction("TargetCorners", "json").bind(this));
    }

    async build() {
	await this.buildIDs();
    }
    
    async buildIDs() {
	this.ids = {};
	for (let i in novaDataTypes) {
	    var dataType = novaDataTypes[i];
	    var dataTypePath = path.join(this.rootPath, dataType);
	    try {
		this.ids[dataType] = await this.readIDsFromDir(dataTypePath);
	    }
	    catch (e) {
		this.ids[dataType] = [];
	    }
	}
    }

    readIDsFromDir(path) {
	return new Promise(function(fulfill, reject) {
	    fs.readdir(path, function(err, items) {
		if (err) {
		    reject(err);
		}
		else {
		    // Remove anything with a . in front of it
		    // Cut off all extensions
		    fulfill(items.filter(x => x[0] != ".").map(x => x.slice(0, x.lastIndexOf("."))));
		}
	    });
	});
    }

    buildResources() {

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
