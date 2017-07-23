"use strict";


var weap = require("./parsers/weap.js");
var rled = require("./parsers/rled.js");
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

    }

    async readNovaFiles(novaFiles) {
	await novaFiles.forEach(async function(novaFileName) {
	    var pathTo = path.join(this.path, "Nova Files", novaFileName);
	    
	    var novaFile = this.readRF(pathTo);
	    await novaFile.read();
	    var parsed = this.parse(novaFile.resources);
	    this.ids.addNovaData(parsed);
	}.bind(this));

    }
    

    async readPlugins(novaPlugins) {
	await novaPlugins.forEach(async function(idPrefix) {
	    var pathTo = path.join(this.path, "Plug-ins", idPrefix);
	    var idSpace = this.ids.getSpace(idPrefix);

	    var isDirectory = await this.isDirectory(pathTo);

	    if (isDirectory) {
		var files = await this.readdir(pathTo);
		files.forEach(async function(f) {

		    var plugIn = this.readRF(path.join(pathTo, f));
		    await plugIn.read();
		    var parsed = this.parse(plugIn.resources);
		    this.ids.addPlugin(parsed, idPrefix);
		    
		}.bind(this));

	    }

	    else {
		var plugIn = this.readRF(pathTo);
		await plugIn.read();
		var parsed = this.parse(plugIn.resources);
		this.ids.addPlugin(parsed, idPrefix);
	    }
	}.bind(this));
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
	    case "rlëD":
		parseFunction = rled;
		break;
	    case "wëap":
		parseFunction = weap;
		break;
	    }
	    parsed[type] = resArray.map(function(item) {

		return new parseFunction(item);

	    });

	}.bind(this));
	return parsed;
    }







    
}

    
exports.novaParse = novaParse;
