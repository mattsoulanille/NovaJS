"use strict";
var PNG = require("pngjs").PNG;
var fs = require("fs");

var base = require("./base.js");

// Adapted from https://github.com/dmaulikr/OpenNova/blob/master/ResourceKit/ResourceFork/Parsers/RKPictureResourceParser.m

// Also see http://mirrors.apple2.org.za/apple.cabi.net/Graphics/PICT.and_QT.INFO/PICT.file.format.TI.txt

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
