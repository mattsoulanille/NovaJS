"use strict";

var base = require("./base.js");

var outf = class extends base {
    constructor(resource) {
	super(...arguments);
	var d = resource.data;

	this.displayWeight = d.getInt16(0);
	this.mass = d.getInt16(2);
	this.techLevel = d.getInt16(4);
	this.modType = d.getInt16(6);
	this.modVal = d.getInt16(8);
	this.functions = [];

	var i = 0;

	switch (this.modType){
	case 1:
	    this.functions[i] = {"weapon" : this.modVal};
	    break;
	}
	
    }
};


module.exports = outf;
