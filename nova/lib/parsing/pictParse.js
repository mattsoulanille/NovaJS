var PNG = require('pngjs').PNG;

var baseParse = require("./baseParse.js");

class pictParse extends baseParse {
    constructor() {
	super(...arguments);
    }
    async parse(PICT) {
	//var out = await super.parse(PICT);
	//out.png = PNG.sync.write(PICT.png);
	//return out.png;
	return PNG.sync.write(PICT.png);
    }
}

module.exports = pictParse;
