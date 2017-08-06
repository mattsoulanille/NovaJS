"use strict";
var PNG = require("pngjs").PNG;
var fs = require("fs");

var base = require("./base.js");

// see https://github.com/tjhancocks/OpenNova/blob/master/ResourceKit/ResourceFork/Parsers/RKRLEResourceParser.m
// see https://github.com/tjhancocks/OpenNova/blob/master/ResourceKit/Categories/NSData%2BParsing.h

var pict = class extends base {
    constructor(resource) {
	super(...arguments);
	var d = resource.data;
    }
};


module.exports = pict;
