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
	
	this.pictID = outf.idSpace.PICT[outf.pictID].globalID;

    }
};

module.exports = outfParse;
