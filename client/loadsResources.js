
if (typeof module !== 'undefined') {
    var _ = require("underscore");

}


var loadsResources = (superclass) => class extends superclass {
    constructor() {
	super(...arguments);
	}
    
    
    async loadResources(type, id) {
	return await(this.novaData[type].get(id));
    }
    
    setProperties() {
	// a modifiable copy of meta.
	// Why is this the best way to make a copy???!!!
	var copy = JSON.parse(JSON.stringify(this.meta));
	if (! ("properties" in this) ) {
	    this.properties = {};
	}

	// Don't overwrite already set things
	// probably should be refactored
	Object.keys(copy).forEach(function(key) {
	    this.properties[key] = copy[key];
	}, this);

    }
};



if (typeof module !== 'undefined') {

    module.exports = loadsResources;
}
