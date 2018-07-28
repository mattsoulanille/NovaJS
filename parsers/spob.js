"use strict";

var base = require("./base.js");

var spob = class extends base {
    constructor(resource) {
	super(...arguments);
	var d = resource.data;
	this.position = [d.getInt16(0), d.getInt16(2)];
	this.graphic = d.getInt16(4);
	this.flags = d.getUint32(6);

	this.tribute = d.getInt16(10);
	this.techLevel = d.getInt16(12);
	this.specialTech = [
	    d.getInt16(14),
	    d.getInt16(16),
	    d.getInt16(18)
	];
	this.government = d.getInt16(20);
	
    }
};

module.exports = spob;
