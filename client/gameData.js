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
	
    }

    addGettable(name) {
	switch(name) {
	case ("spriteSheetImage"):
	    this.data[name] = new gettable(this._makeGetFunction(name, ".png"));
	    break;
	default:
	    this.data[name] = new gettable(this._makeGetFunction(name, ".json"));
	}
    }

    // The function for the gettable
    _makeGetFunction(name, extension) {
	return function(item) {
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
