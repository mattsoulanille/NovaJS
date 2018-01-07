var baseParse = require("./baseParse.js");

var explosionParse = class extends baseParse {
    constructor(boom) {
	super(...arguments);
	var spin = boom.idSpace.spïn[boom.graphic];
	var rled = spin.idSpace.rlëD[spin.spriteID];
	this.animation = {
	    id : rled.prefix + ":" + rled.id,
	    // 100 is 30 fps is 1000/30 ms
	    // 50 is 15 fps is 1000/15 ms
	    frameTime : 1000 / (boom.animationRate * 30/100)
	};

	this.sound = boom.sound; // change me
    }
};

module.exports = explosionParse;
