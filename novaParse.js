"use strict";


var weap = require("./parsers/weap.js");
var rled = require("./parsers/rled.js");

class novaParse {
    constructor(resources) {
	this.resources = resources;
	this.parsed = {};
    }

    parse() {
	Object.keys(this.resources).forEach(function(type) {
	    var resArray = this.resources[type];
	    var parseFunction = function() {};

	    switch(type) {
	    case "rlëD":
		parseFunction = rled;
		break;
	    }

	    this.parsed[type] = resArray.map(parseFunction);

	}.bind(this));
    }
}

    
exports.novaParse = novaParse;
