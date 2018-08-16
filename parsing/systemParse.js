const baseParse = require("./baseParse.js");


class systemParse extends baseParse {
    constructor(syst) {
	super(...arguments);
	
	this.position = syst.position;
	this.links = [];
	syst.links.forEach(function(link) {
	    this.links.push(syst.idSpace.sÿst[link].globalID); // Not a set for JSON
	}.bind(this));
	this.planets = syst.spobs.map(function(spobID) {
	    if (spobID < 128) {
		return null;
	    }
	    else {
		return syst.idSpace.spöb[spobID].globalID;
	    }
	});

    }
};

module.exports = systemParse;
