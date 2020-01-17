const baseParse = require("./baseParse.js");


class planetParse extends baseParse {
    constructor() {
	super(...arguments);
    }
    async parse(planet) {
	var out = await super.parse(planet);

	out.type = "planet"; // system needs to know what to build
	out.position = [planet.position[0], -planet.position[1]];
	try {
	    out.landingPictID = planet.idSpace.PICT[planet.landingPictID].globalID;
	}
	catch(e) {
	    console.log("Parsing pict failed: " + e.message);
	}

	try {
	    out.landingDesc = planet.idSpace.dësc[planet.landingDescID].string;
	}
	catch(e) {
	    out.desc = "Parsing desc failed: " + e.message;
	}

	out.animation = {
	    images: {
		baseImage: {
		    id: planet.idSpace['rlëD'][planet.graphic].globalID,
		    imagePurposes: {
			normal: { // Change this when things get animations.
			    start: 0,
			    end: 1
			}
		    }
		}
	    }
	};

	return out;
    }
}

module.exports = planetParse;
