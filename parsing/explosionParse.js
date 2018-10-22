var baseParse = require("./baseParse.js");

var explosionParse = class extends baseParse {
    constructor() {
	super(...arguments);
    }

    parse(boom) {
	var out = super.parse(...arguments);
	var spin = boom.idSpace.spïn[boom.graphic];
	var rled = spin.idSpace.rlëD[spin.spriteID];
	out.animation = {
	    id : rled.globalID,
	    // 100 is 30 fps is 1000/30 ms
	    // 50 is 15 fps is 1000/15 ms
	    frameTime : 1000 / (boom.animationRate * 30/100)
	};

	out.sound = boom.sound; // change me
	return out;
    }
};

module.exports = explosionParse;
