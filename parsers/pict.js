"use strict";
var PNG = require("pngjs").PNG;
var fs = require("fs");

var base = require("./base.js");

var PICTParse = require("./PICTParse.js");
class pict extends base {
    constructor(resource) {
	super(...arguments);
	var d = resource.data;
	try {
	    var PICT = new PICTParse(d);
	}
	catch (e) {
	    throw new Error("PICT id " + this.id + " failed to parse: " + e.message);
	}
	//PICT.PNG.pack().pipe(fs.createWriteStream("out" + this.id + ".png"));
	this.png = PICT.PNG;
    }
};

module.exports = pict;
