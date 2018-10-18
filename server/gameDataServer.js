//var gameData = require("../client/gameData.js");
const gettable = require("../libraries/gettable.js");
const novaDataTypes = require("../parsing/novaDataTypes.js");
const fs = require("fs");
const path = require("path");
const filesystemData = require("../parsing/filesystemData.js");
const gameDataSuper = require("../superclasses/gameDataSuper.js");
const novaData = require("../parsing/novaData.js");

// This combines all sources of data into one place to get data from.
class gameDataServer extends gameDataSuper {
    // TODO: Make this create its own novaData
    constructor(app) {
	super();
	this.app = app;

	this.novaData = new novaData("./Nova\ Data");
	this.filesystemData = new filesystemData("objects");

	this.dataSources = [this.novaData, this.filesystemData];

	this.app.get(path.join(this.resourcePath, ":name/:item.json"),
		     this._requestFulfiller.bind(this));
	this.app.get(path.join(this.resourcePath, ":name/:item.png"),
		     this._requestFulfiller.bind(this));
	// Extensions are so that the PIXI loader knows how to interpret the data.
	
	
	this.setupDataSources();
    }

    async _build() {
	await this.filesystemData.build();
	await this.novaData.build();
	
	this.setupIDs();
	this.app.get(path.join(this.metaPath, "ids.json"), function(req, res) {
	    res.send(this.ids);
	}.bind(this));
	super._build();
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

    setupIDs() {
	this.ids = {};
	for (let i in novaDataTypes) {
	    var dataType = novaDataTypes[i];
	    this.ids[dataType] = [];
	    for (let j in this.dataSources) {
		let dataSource = this.dataSources[j];
		if (typeof dataSource.ids[dataType] !== 'undefined') {
		    this.ids[dataType] = [...this.ids[dataType], ...dataSource.ids[dataType]];
		}
	    }
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
    }

}

module.exports = gameDataServer;
