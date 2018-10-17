const gettable = require("../libraries/gettable.js");
const PIXI = require("pixi.js");
const path = require("path");
const novaDataTypes = require("../parsing/novaDataTypes.js");

const prefix = "/gameData/";


class gameData {
    constructor() {
	this.data = {};

	for (let i in novaDataTypes) {
	    let name = novaDataTypes[i];
	    this.addGettable(name);
	}

	// TODO: Make this into a more permanenet solution for filesystem access
	// TEMPORARY UNTIL STATUSBARS CAN BE PARSED
	this.addGettable("statusBars");

	this.data.sprite = {};
	this.data.sprite.fromPict = this.getSpriteFromPict;
	this.data.texture = {};
	this.data.texture.fromPict = this.getTextureFromPict;
	
    }

    getSpriteFromPict(globalID) {
	if (typeof globalID == "undefined") {
	    console.warn("No ID given so returning empty sprite");
	    return new PIXI.Sprite();
	}
	return new PIXI.Sprite.fromImage(path.join(prefix, "picts", globalID + ".png"));
    }

    getTextureFromPict(globalID) {
	if (typeof globalID == "undefined") {
	    console.warn("No ID given so returning empty texture");
	    return new PIXI.Texture();
	}
	return new PIXI.Texture.fromImage(path.join(prefix, "picts", globalID + ".png"));
    }
    
    addGettable(name) {
	var extension;
	switch(name) {
	case ("spriteSheetImage"):
	    extension = ".png";
	    break;
	case ("pict"):
	    extension = ".png";
	    break;
	default:
	    extension = ".json";
	}
	this.data[name] = new gettable(this._makeGetFunction(name, extension));
	
    }

    // The function for the gettable
    _makeGetFunction(name, extension) {
	return function(item) {
	    if (typeof item == "undefined") {
		throw new Error("Requested undefined item");
	    }
	    return new Promise(function(fulfill, reject) {
		var loader = new PIXI.loaders.Loader();
		var url = path.join(prefix, name, item + extension);
		loader
		    .add(url, url)
		    .load(function(loader, resource) {
			if (resource[url].error) {
			    console.warn("error loading " + url);
			    reject(resource[url].error);
			}
			else {
			    fulfill(resource[url].data);
			}
		    });
	    });
	};
    }
}


module.exports = gameData;
