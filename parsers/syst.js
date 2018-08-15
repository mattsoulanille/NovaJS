"use strict";

var base = require("./base.js");

var syst = class extends base {
    constructor(resource) {
	super(...arguments);
	var d = resource.data;
	this.position = [d.getInt16(0), d.getInt16(2)];

	this.links = new Set();
	for (let i = 0; i < 16; i++) {
	    var link = d.getInt16(4 + i * 2);
	    if (link >= 128) {
		this.links.add(link);
	    }
	}

	this.spobs = [];
	for (let i = 0; i < 16; i++) {
	    this.spobs[i] = d.getInt16(36 + i * 2);
	}

    }
};

module.exports = syst;
