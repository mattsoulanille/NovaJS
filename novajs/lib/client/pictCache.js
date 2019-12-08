var cache = require("./cache.js");
var pictCache = class extends cache {
    constructor() {
	super(...arguments);

    }

    get(id) {
	if ( !(this.cached[id]) ) {
	    this.cached[id] = this.getURL(this.prefix_url + id + ".png");
	}
	return this.cached[id];
    }
};
module.exports = pictCache;
