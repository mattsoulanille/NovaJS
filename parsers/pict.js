"use strict";
var PNG = require("pngjs").PNG;
var fs = require("fs");

var base = require("./base.js");

var PICTParse = require("./PICTParse.js");
class pict extends base {
    constructor(resource) {
	super(...arguments);
	var d = resource.data;
	var PICT = new PICTParse(d);
	PICT.PNG.pack().pipe(fs.createWriteStream("out" + this.id + ".png"));
    }
};

module.exports = pict;
