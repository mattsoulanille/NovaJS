"use strict";


var boom = require("./parsers/boom.js");
var outf = require("./parsers/outf.js");
var rled = require("./parsers/rled.js");
var shan = require("./parsers/shan.js");
var ship = require("./parsers/ship.js");
var spin = require("./parsers/spin.js");
var weap = require("./parsers/weap.js");
var pict = require("./parsers/pict.js");
var desc = require("./parsers/desc.js");
var idSpace = require("./idSpace.js");
var fs = require("fs");
var path = require('path');
var rf = require("resourceforkjs").resourceFork;


class novaParse {
    constructor(path) {
	this.path = path;
	this.ids = new idSpace();
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
	    //return Promise.all(novaPlugins.map(async function(idPrefix) {
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
		parseFunction = ship;
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
	    }
	    parsed[type] = resArray.map(function(item) {
		return function() {
		    return new parseFunction(item);
		};
	    });

	}.bind(this));
	return parsed;
    }







    
}


module.exports = novaParse;
//exports.novaParse = novaParse;
