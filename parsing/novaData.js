
var spriteSheet = require("./spriteSheet.js");
var shanParse = require("./shanParse.js");
var shipParse = require("./shipParse.js");
var weapParse = require("./weapParse.js");


var gettable = class {
    constructor(getFunction) {
	this.data = {};
	this.getFunction = getFunction;
    }
    getSync(thing) {
	if (! (thing in this.data) ) {
	    this.data[thing] = this.getFunction(thing);
	}
	
	return this.data[thing];
    }
    async get(thing) {
	// wraps it in a promise so it looks async
	// for the in-browser style things
	return this.getSync(thing);
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
	return function(fullId) {
	    var index = fullId.lastIndexOf(":");
	    var prefix = fullId.slice(0, index);
	    var id = fullId.slice(index + 1);

	    var resource = this.novaParse.ids.getSpace(prefix)[resourceType][id];
	    if (resource) {
		return new toBuild(resource);
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
