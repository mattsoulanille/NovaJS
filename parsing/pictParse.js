var PNG = require('pngjs').PNG;

var baseParse = require("./baseParse.js");

class pictParse extends baseParse {
    constructor(PICT) {
	super(...arguments);
	this.png = PICT.png;
    }

    /*
    get png() {
	if (!this._png) {
	    this._png = PICT.png;
	}
    }

    set png(v) {
	throw new Error("Can't set png of pictParse");
    }
*/

}

module.exports = pictParse;
