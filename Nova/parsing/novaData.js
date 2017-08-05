
var spriteSheet = require("./spriteSheet.js");
var shanParse = require("./shanParse.js");

var novaData = class {
    constructor(parsed) {
	this.novaParse = parsed;
	this.spriteSheets = {};	
	this.shans = {};

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
