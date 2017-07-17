"use strict";

// see https://github.com/tjhancocks/OpenNova/blob/master/ResourceKit/ResourceFork/Parsers/RKRLEResourceParser.m
// see https://github.com/tjhancocks/OpenNova/blob/master/ResourceKit/Categories/NSData%2BParsing.h
var rled = function(resource) {
    var d = resource.data;
    var out = {};
    out.name = resource.name;
    out.id = resource.id;
    out.size = [d.getUint16(0), d.getUint16(2)];
    out.bytesPerPixel = d.getUint16(4);
    if (out.bytesPerPixel !== 16) {
	throw("Only color depth of 16 bytes / pixel supported but got " + out.bytesPerPixel);
    }
    
    out.numberOfFrames = d.getUint16(8);
    out.bytesPerRow = out.size[0] * 3;

    

    return out;
};

module.exports = rled;
