"use strict";

// see https://github.com/tjhancocks/OpenNova/blob/master/ResourceKit/ResourceFork/Parsers/RKRLEResourceParser.m
// see https://github.com/tjhancocks/OpenNova/blob/master/ResourceKit/Categories/NSData%2BParsing.h
var rled = function(resource) {
    var d = resource.data;
    var out = {};
    out.name = resource.name;
    out.id = resource.id;

    return out;
};

module.exports = rled;
