"use strict";

var base = require("./base.js");

var outf = class extends base {
    constructor(resource) {
	super(...arguments);
	var d = resource.data;
    }
};


module.exports = outf;
