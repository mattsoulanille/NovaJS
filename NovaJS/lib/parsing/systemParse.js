const baseParse = require("./baseParse.js");


class systemParse extends baseParse {
    constructor() {
	super(...arguments);
    }
    async parse(syst) {
	var out = await super.parse(syst);

	out.position = syst.position;
	out.links = [];
	syst.links.forEach(function(link) {
	    out.links.push(syst.idSpace.sÿst[link].globalID); // Not a set for JSON
	});
	out.planets = syst.spobs.map(function(spobID) {
	    if (spobID < 128) {
		return null;
	    }
	    else {
		return syst.idSpace.spöb[spobID].globalID;
	    }
	});

	return out;
    }
};

module.exports = systemParse;
