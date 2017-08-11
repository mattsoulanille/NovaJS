
if (typeof module !== 'undefined') {
    var _ = require("underscore");

}


var loadsResources = (superclass) => class extends superclass {
    constructor() {
	super(...arguments);
	}
    
    
    async loadResources() {
	this.meta = await(this.novaData[this.type].get(this.buildInfo.id));
    }
    
    setProperties() {
	// a modifiable copy of meta.
	this.properties = this.properties || {};
	_.each(this.meta, function(value, key) {
	    this.properties[key] = value;
	}, this);
	// revise me
    }
};



if (typeof module !== 'undefined') {

    module.exports = loadsResources;
}
