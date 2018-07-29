var baseParse = require("./baseParse.js");
var weapParse = require("./weapParse.js");

var outfParse = class extends baseParse {
    constructor(outf) {
	super(...arguments);

	this.name = outf.name;
	let functions = outf.functions;

	var weapons = {};

	this.weapon = null;
	functions.forEach(function(f) {
	    if (f.hasOwnProperty("weapon")) {
		if (this.weapon === null) {
		    if (f.weapon >= 128) {
			let globalID = outf.idSpace.wëap[f.weapon].globalID;
		    
			this.weapon = {
			    id: globalID,
			    count: 1
			};
		    }
		}
		else {
		    throw new Error("Outfit has multiple weapons: " + outf.name);
		}
	    }
	}.bind(this));


	this.functions = {};

	functions.forEach(function(a) {
	    Object.keys(a).forEach(function(key) {
		if (key !== "weapon") {
		    this.functions[key] = a[key];
		}
		if (key == "fuel scoop") {
		    this.functions[key] = 1 / a[key]; // units / frame instead of frames / unit
		}
	    }.bind(this));
	}.bind(this));


	// Put these in try-catch blocks
	// but first, make custom errors for novaParse
	// Also, have placeholders.
	try {
	    this.pictID = outf.idSpace.PICT[outf.pictID].globalID;
	}
	catch(e) {
	}
	try {
	    this.desc = outf.idSpace.dësc[outf.descID].string;
	}
	catch(e) {
	    this.desc = "Parsing desc failed: " + e.message;
	}

	this.mass = outf.mass;
	this.price = outf.cost;
	if (this.displayWeight > 0) {
	    this.displayWeight = outf.displayWeight;
	}
	else {
	    this.displayWeight = outf.id;
	}
	this.max = outf.max;
    }
};

module.exports = outfParse;
