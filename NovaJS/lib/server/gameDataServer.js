//var gameData = require("../client/gameData.js");
const gettable = require("../libraries/gettable.js");
const novaDataTypes = require("../parsing/novaDataTypes.js");
const fs = require("fs");
const path = require("path");
const filesystemData = require("../parsing/filesystemData.js");
const gameDataSuper = require("../common/gameDataSuper.js");
const NovaParse = require("novaparse").NovaParse;
const NoNovaFilesError = require("../client/errors.js").NoNovaFilesError;

// This combines all sources of data into one place to get data from.
class gameDataServer extends gameDataSuper {
    // TODO: Make this create its own novaData
    constructor(app) {
	super();
	this.app = app;

	// preloaded resources are fully parsed and given
	// to the clients in one request when they connect
	// so they don't have to request them all individually.
	this.preload = ["Outfit", "Ship"];
	
	this.novaData = new NovaParse("./Nova\ Data", false);
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

	this.meta.ids = await this.novaData.ids;
	this.meta.shipIDMap = await this.setupShipIDMap();

	this.meta.preloadCache = {};
	await this.buildPreloadCache();

	this.app.get(path.join(this.metaPath), function(req, res) {
	    res.send(this.meta);
	}.bind(this));
	super._build();
    }


    async buildPreloadCache() {
	for (let i in this.preload) {
	    var dataType = this.preload[i];
	    this.meta.preloadCache[dataType] = await this._getAll(dataType);
	}
    }

    async _getAll(dataType) {
	var toReturn = {};
    	var gettable = this.data[dataType];
    	var ids = this.meta.ids[dataType];
	for (let i in ids) {
	    let id = ids[i];
	    toReturn[id] = await this.data[dataType].get(id);
	}
	return toReturn;
    }

    // getParseErrorMessage(dataType, id, e) {
    // 	return "Failed to parse " + dataType + " " + id + ".\n" +
    // 	    "This " + dataType + " will not be available. Stacktrace: \n" + e.stack;
    // }
    
    async setupShipIDMap() {
	var out = {};
	for (let i in this.meta.ids.Ship) {
	    var id = this.meta.ids.Ship[i];
	    var ship = await this.data.Ship.get(id);
	    out[ship.name] = id;
	}
	return out;
    }
    
    setupDataSources() {
	for (let i in novaDataTypes) {
	    let name = novaDataTypes[i];
	    this.addGettable(name, new gettable(async function(item) {
		
		let errors = [];
		for (let i in this.dataSources) {
		    let dataSource = this.dataSources[i];
		    
		    try {
			return await dataSource.data[name].get(item);
		    }
		    catch (e) {
			errors.push(e);
		    }
		}
		console.warn(item + " not found under " + name + ". Using default instead. "
			     + "\nStacktraces:\n"
			     + errors.map(x => x.stack).join("\n"));
		// For now, this assumes the first ID parses correctly.
		// TODO: Make a real default for each resource.
		return await this.data[name].get(this.meta.ids[name][0]);
		
	    }.bind(this)));
	}
    }

    async _requestFulfiller(req, res, next) {
	try {
	    var data = await this.data[req.params.name].get(req.params.item);
	    res.send(data);
	}
	catch (e) {
	    res.send(false);
	    debugger;
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
