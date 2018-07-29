
var baseParse = class {
    constructor(resource) {
	this.id = resource.globalID;
	this.name = resource.name;
	this.prefix = resource.prefix;
    }
}

module.exports = baseParse;
