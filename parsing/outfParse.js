var baseParse = require("./baseParse.js");
var weapParse = require("./weapParse.js");

var outfParse = class extends baseParse {
    constructor() {
	super(...arguments);
    }

    async parse(outf) {
	var out = await super.parse(outf);

	let functions = outf.functions;

	var weapons = {};

	out.weapon = null;
	functions.forEach(function(f) {
	    if (f.hasOwnProperty("weapon")) {
		if (out.weapon === null) {
		    if (f.weapon >= 128) {
			let globalID = outf.idSpace.wëap[f.weapon].globalID;
		    
			out.weapon = {
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


	out.functions = {};

	functions.forEach(function(a) {
	    Object.keys(a).forEach(function(key) {
		if (key !== "weapon") {
		    out.functions[key] = a[key];
		}
		if (key == "fuel scoop") {
		    out.functions[key] = 1 / a[key]; // units / frame instead of frames / unit
		}
	    }.bind(this));
	}.bind(this));


	// Put these in try-catch blocks
	// but first, make custom errors for novaParse
	// Also, have placeholders.
	try {
	    out.pictID = outf.idSpace.PICT[outf.pictID].globalID;
	}
	catch(e) {
	}
	try {
	    out.desc = outf.idSpace.dësc[outf.descID].string;
	}
	catch(e) {
	    out.desc = "Parsing desc failed: " + e.message;
	}

	out.mass = outf.mass;
	out.price = outf.cost;
	if (out.displayWeight > 0) {
	    out.displayWeight = outf.displayWeight;
	}
	else {
	    out.displayWeight = outf.id;
	}
	out.max = outf.max;


	return out;
    }
};

module.exports = outfParse;
