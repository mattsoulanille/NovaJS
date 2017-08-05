
var spriteSheet = require("./spriteSheet.js");
var shanParse = require("./shanParse.js");

var gettable = class {
    constructor() {}
    async get(thing) {
	// wraps it in a promise so it looks async
	// for the in-browser style things
	return this[thing];
    }
};


// should mirror novaCache.js

var novaData = class {
    constructor(parsed) {
	this.novaParse = parsed;
	this.spriteSheets = new gettable();
	this.shans = new gettable();

    }

    build() {
	this.buildSpriteSheets();
	this.buildShans();
    }

    buildSpriteSheets() {
	Object.keys(this.novaParse.ids.resources.rlëD).forEach(function(key) {
	    var rled = this.novaParse.ids.resources.rlëD[key];
	    this.spriteSheets[key] = new spriteSheet(rled);
	}.bind(this));

    }


    buildShans() {
	// implement caching of spriteSheets if out of ram
	// try to keep ram usage under 4 gb if able (would be sweet if < 2)
	Object.keys(this.novaParse.ids.resources.shän).forEach(function(key) {
	    var shan = this.novaParse.ids.resources.shän[key];
	    this.shans[key] = new shanParse(shan);
	}.bind(this));


    }

    buildShips() {

    }
    

};

module.exports = novaData;
