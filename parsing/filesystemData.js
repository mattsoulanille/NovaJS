const gettable = require("../libraries/gettable.js");
const path = require("path");
const fs = require("fs");
const novaDataTypes = require("./novaDataTypes");


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
		    fulfill(items.filter(x => x[0] != ".")); // Remove anything with leading .
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
