
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

/*
	this.shans = new gettable(function(id) {
	    var shan = this.novaParse.ids.resources.shän[id];
	    return new shanParse(shan);
	}.bind(this));
*/
	this.ships = new gettable(this.getFunction("shïp", shipParse));
	this.weapons = new gettable(this.getFunction("wëap", weapParse));
	
    }

    getFunction(prefix, toBuild) {
	return function(id) {
	    var resource = this.novaParse.ids.resources[prefix][id];
	    if (resource) {
		return new toBuild(resource);
	    }
	    else {
		throw new Error("not found in novaParse");
	    }
	}.bind(this);

    }


    build() {

    }
};

module.exports = novaData;
