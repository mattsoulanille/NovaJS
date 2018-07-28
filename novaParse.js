"use strict";


const boom = require("./parsers/boom.js");
const outf = require("./parsers/outf.js");
const rled = require("./parsers/rled.js");
const shan = require("./parsers/shan.js");
//const ship = require("./parsers/ship.js");
const shipParserMaker = require("./shipPictProxy.js");
const spin = require("./parsers/spin.js");
const weap = require("./parsers/weap.js");
const pict = require("./parsers/pict.js");
const desc = require("./parsers/desc.js");
const spob = require("./parsers/spob.js");
const idSpace = require("./idSpace.js");
const fs = require("fs");
const path = require('path');
const rf = require("resourceforkjs").resourceFork;
const parsedObject = require("./parsedObject.js");

class novaParse {
    constructor(path) {
	this.path = path;
	this.ids = new idSpace();

	// Ships with the same baseImage are given the same pict id
	// if they don't have their own. I don't know why they didn't
	// just add another field to ship.
	this._shipBaseImagePictMap = {};
	this.shipParser = shipParserMaker(this);
    }

    readdir(path) {
	return new Promise(function(fulfill, reject) {
	    fs.readdir(path, function(err, files) {
		if (err) {
		    reject(err);
		}
		else {
		    fulfill(files.filter(function(p) {
			return p[0] !== '.';
		    }));
		}
	    });
	});
    }

    isDirectory(path) {
	return new Promise(function(fulfill, reject) {
		fs.stat(path, function(err, stats) {
		    if (err) {
			reject(err);
		    }
		    else {
			fulfill(stats);
		    }			
		});
	}).then(function(stats) {
	    return stats.isDirectory();
	});

    }
    
    async read() {

	
	// Nova files must be shallowly placed in Nova Files
	this.novaFiles = await this.readdir(path.join(this.path, "Nova Files"));


	// Each file / directory in Plug-ins gets its own id space (tied to nova files id space)
	// see idSpace.js for more info
	this.novaPlugins = await this.readdir(path.join(this.path, "Plug-ins"));
	await this.readNovaFiles(this.novaFiles);
	await this.readPlugins(this.novaPlugins);

	this.makeShipBaseImagePictMap();
	return;
    }

    async readNovaFiles(novaFiles) {
	// some total conversions may expect that later files will
	// overwrite earlier ones, so novaFiles must be read in order
	for (var fileIndex in novaFiles) {
	    //return Promise.all(novaFiles.map(async function(novaFileName) {
	    var novaFileName = novaFiles[fileIndex];
	    var pathTo = path.join(this.path, "Nova Files", novaFileName);	
	    if (pathTo.slice(-5) !== ".ndat") {
		continue; // don't read the nova music or the quicktime movies
	    }
    
	    var novaFile = this.readRF(pathTo);
	    await novaFile.read();
	    var parsed = this.parse(novaFile.resources);
	    this.ids.addNovaData(parsed);
	}
    }
    

    async readPlugins(novaPlugins) {
	// these may overwrite the same data in nova files
	// so they must be read in order
	for (var pluginIndex in novaPlugins) {
	    var idPrefix = novaPlugins[pluginIndex];
	    var pathTo = path.join(this.path, "Plug-ins", idPrefix);
	    var idSpace = this.ids.getSpace(idPrefix);

	    var isDirectory = await this.isDirectory(pathTo);

	    if (isDirectory) {
		var files = await this.readdir(pathTo);

		// these share id space so they must be read in order
		// so they can overwrite one another

		for (var fileIndex in files) {
		    var f = files[fileIndex];
		    var plugIn = this.readRF(path.join(pathTo, f));
		    await plugIn.read();
		    var parsed = this.parse(plugIn.resources);
		    this.ids.addPlugin(parsed, idPrefix);
		}
		
	    }

	    else {
		var plugIn = this.readRF(pathTo);
		await plugIn.read();
		var parsed = this.parse(plugIn.resources);
		this.ids.addPlugin(parsed, idPrefix);
	    }
	}
    }

    
    readRF(p) {
	// use resource fork
	var useRF = (p.slice(-5) !== ".ndat");
	return new rf(p, useRF);
	
	
    }
    
    makeShipBaseImagePictMap() {
	
	var map = this._shipBaseImagePictMap;
	for (let shipID in this.ids.resources.shïp) {
	    var currentShip = this.ids.resources.shïp[shipID];
	    
	    var p = currentShip.idSpace.PICT[currentShip.id - 128 + 5000];

	    if (typeof p !== "undefined") {
		var shan, baseImageLocalID, baseImageGlobalID;

		try {
		    shan = currentShip.idSpace.shän[currentShip.id];
		}
		catch (e) {
		    e.message = "No shan found for ship id " + currentShip.globalID + " : " + e.message;
		    throw e;
		}
		try {
		    baseImageLocalID = shan.baseImage.ID;
		}
		catch (e) {
		    e.message = "No baseImage found for shan id " + shan.globalID + " : " + e.message;
		    throw e;
		}
		try {
		    baseImageGlobalID = shan.idSpace.rlëD[baseImageLocalID].globalID;
		}
		catch (e) {
		    e.message = "No rled found for baseImage localID " + baseImageLocalID + " : " + e.message;
		}
		
		map[baseImageGlobalID] = currentShip.id - 128 + 5000;
	    }
	}
    }
    
    parse(resources) {
	var parsed = {};
	Object.keys(resources).forEach(function(type) {
	    var resArray = resources[type];
	    var parseFunction = function() {};

	    switch(type) {
	    case "bööm":
		parseFunction = boom;
		break;
	    case "oütf":
		parseFunction = outf;
		break;
	    case "rlëD":
		parseFunction = rled;
		break;
	    case "shän":
		parseFunction = shan;
		break;
	    case "shïp":
		parseFunction = this.shipParser;
		break;
	    case "spïn":
		parseFunction = spin;
		break;
	    case "wëap":
		parseFunction = weap;
		break;
	    case "PICT":
		parseFunction = pict;
		break;
	    case "dësc":
		parseFunction = desc;
		break;
	    case "spöb":
		parseFunction = spob;
		break;
	    }	    
	    parsed[type] = resArray.map(function(item) {
		// function necessary so no reference to parsedObject so no cacheing
		return function() {	
		    return new parsedObject(function() {
			return new parseFunction(item);
		    }.bind(this));
		    //return new parseFunction(item);
		};
	    });

	}.bind(this));
	return parsed;
    }
}


module.exports = novaParse;
//exports.novaParse = novaParse;
