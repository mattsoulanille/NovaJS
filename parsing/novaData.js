
var spriteSheet = require("./spriteSheet.js");
var shanParse = require("./shanParse.js");
var shipParse = require("./shipParse.js");
var weapParse = require("./weapParse.js");


var gettable = class {
    constructor(getFunction) {
	this.data = {};
	this.getFunction = getFunction;
    }

    async get(thing) {
	if (! (thing in this.data) ) {
	    this.data[thing] = this.getFunction(thing);
	}

	// Goes here so it acutally enters the data object while resolving.
	return await this.data[thing];
    }
};


// should mirror novaCache.js

var novaData = class {
    constructor(parsed) {
	this.novaParse = parsed;
	this.spriteSheets = new gettable(this.getFunction("rlëD", spriteSheet));
	this.ships = new gettable(this.getFunction("shïp", shipParse));
	this.weapons = new gettable(this.getFunction("wëap", weapParse));

    }

    getFunction(resourceType, toBuild) {

	return async function(fullId) {
	    var index = fullId.lastIndexOf(":");
	    var prefix = fullId.slice(0, index);
	    var id = fullId.slice(index + 1);

	    var resource = this.novaParse.ids.getSpace(prefix)[resourceType][id];
	    if (resource) {
		let obj =  new toBuild(resource);
		if ("build" in obj) {
		    await obj.build();
		}
		return obj;
	    }
	    else {
		throw new Error(fullId + " not found in novaParse under " + resourceType);
	    }
	}.bind(this);

    }


    build() {

    }
};

module.exports = novaData;
