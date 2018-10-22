var resourcesPrototypeHolder = require("./resourcesPrototypeHolder");
var loadsResources = (superclass) => class extends superclass {
    constructor() {
	super(...arguments);
	if (! this.data) {
	    this.data = resourcesPrototypeHolder.prototype.data;
	}
	if (! this.socket) {
	    this.socket = resourcesPrototypeHolder.prototype.socket;
	}
    }
    
    
    async loadResources(type, id) {
	return await(this.data[type].get(id));
    }

    setProperties() {
	// a modifiable copy of meta.
	// Why is this the best way to make a copy???!!!
	var copy = JSON.parse(JSON.stringify(this.meta));

	if (! ("properties" in this) ) {
	    this.properties = {};
	}

	// Don't overwrite things that aren't present in copy
	// probably should be refactored
	Object.keys(copy).forEach(function(key) {
	    this.properties[key] = copy[key];
	}, this);

    }
};

module.exports = loadsResources;

