const baseParse = require("./baseParse.js");


class planetParse extends baseParse {
    constructor(planet) {
	super(...arguments);

	this.type = "planet"; // system needs to know what to build
	this.name = planet.name;
	this.position = [planet.position[0], -planet.position[1]];
	try {
	    this.landingPictID = planet.idSpace.PICT[planet.landingPictID].globalID;
	}
	catch(e) {
	    console.log("Parsing pict failed: " + e.message);
	}

	try {
	    this.landingDesc = planet.idSpace.dësc[planet.landingDescID].string;
	}
	catch(e) {
	    this.desc = "Parsing desc failed: " + e.message;
	}

	this.animation = {
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
    }
}

module.exports = planetParse;
