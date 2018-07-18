"use strict";
require("stringview");
const base = require("./base.js");

class desc extends base {

    constructor(desc) {
	super(...arguments);
	this.string = this.data.getStringNT(0);
	
	
	
    }

};

module.exports = desc;
