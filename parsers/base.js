"use strict";


var base = class {

    constructor(resource) {
	this.name = resource.name;
	this.id = resource.id;
	this.data = resource.data;
    }

};

module.exports = base;
