//var gameData = require("../client/gameData.js");
const gettable = require("../libraries/gettable.js");
const novaDataTypes = require("../parsing/novaDataTypes.js");
const fs = require("fs");
const path = require("path");
var filesystemData = require("../parsing/filesystemData.js");

// This combines all sources of data into one place to get data from.
class gameDataServer {
    // TODO: Make this create its own novaData
    constructor(app, novaData) {
	this.data = {};
	this.app = app;
	this.novaData = novaData;
	this.filesystemData = new filesystemData("objects");
	this.dataSources = [this.novaData, this.filesystemData];

	this.app.get('/gameData/:name/:item.json', this._requestFulfiller.bind(this));
	this.app.get('/gameData/:name/:item.png', this._requestFulfiller.bind(this));
	// Extensions are so that the PIXI loader knows how to interpret the data.

	this.setupDataSources();
    }

    setupDataSources() {
	for (let i in novaDataTypes) {
	    let name = novaDataTypes[i];
	    this.addGettable(name, new gettable(async function(item) {
		
		let errors = [];
		for (let i in this.dataSources) {
		    let dataSource = this.dataSources[i];
		    
		    try {
			return await dataSource[name].get(item);
		    }
		    catch (e) {
			errors.push(e);
		    }
		}
		throw new Error(item + " not found under " + name + "\nStacktraces:\n"
				+ errors.map(x => x.stack).join("\n"));
	    }.bind(this)));
	}
    }

    async _requestFulfiller(req, res, next) {
	try {
	    var data = await this.data[req.params.name].get(req.params.item);
	    res.send(data);
	}
	catch (e) {
	    next(e);
	}
    }
    
    addGettable(name, g) {
	if (! (g instanceof gettable) ) {
	    throw new Error("addGettable must be given a gettable");
	}
	// Add to its own data
	this.data[name] = g;

	// Add a route so the client can get it too.

    }

}

module.exports = gameDataServer;
