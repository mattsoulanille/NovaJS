"use strict";

var base = require("./base.js");

var boom = class extends base {

    constructor(resource) {
	super(...arguments);

	var d = this.data;
	this.animationRate = d.getInt16(0);
	this.sound = d.getInt16(2);
	if(this.sound != -1)
	    this.sound += 300;
	else
	    this.sound = null;
	this.graphic = d.getInt16(4);
	if(this.graphic != -1)
	    this.graphic += 400;
    }

};
module.exports = boom;
