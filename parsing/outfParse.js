var baseParse = require("./baseParse.js");
var weapParse = require("./weapParse.js");

var outfParse = class extends baseParse {
    constructor(outf) {
	super(...arguments);

	this.name = outf.name;
	let functions = outf.functions;

	var weapons = {};
	functions.forEach(function(f) {
	    if (f.hasOwnProperty("weapon")) {
		let globalID = outf.idSpace.wëap[f.weapon].globalID;
		if (!weapons.hasOwnProperty(globalID)) {
		    weapons[globalID] = 0;
		}
		weapons[globalID] += 1;
	    }
	}.bind(this));

	this.weapons = Object.keys(weapons).map(function(id) {
	    return {"id":id, "count":weapons[id]};
	}.bind(this));


	this.functions = {};

	functions.forEach(function(a) {
	    Object.keys(a).forEach(function(key) {
		if (key !== "weapon") {
		    this.functions[key] = a[key];
		}
	    }.bind(this));
	}.bind(this));	
    }
};

module.exports = outfParse;
