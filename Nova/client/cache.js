if (typeof(module) !== 'undefined') {
    var PIXI = require("../server/pixistub.js");
}



var cache = class {
    
    constructor(prefix_url) {
	this.prefix_url = prefix_url;
	this.cached = {};
    }



    getURL(url) {
	return new Promise(function(fulfill, reject) {
	    var loader = new PIXI.loaders.Loader();
	    loader
		.add('data', url)
		.load(function(loader, resource) {
		    if (resource.data.error) {
			console.log("error in loading");
			reject(resource.data.error);
		    }
		    else {
			fulfill(resource.data.data);
		    }
		});

	}.bind(this));
    }


    get(id) {
	if ( !(this.cached[id]) ) {
	    this.cached[id] = this.getURL(this.prefix_url + id).then(
		function() {},
		function() {
		    //if rejected, remove it from this.cached
		    this.cached[id] = null;
		}.bind(this));
	}

	return this.cached[id];
    }
    



};

if (typeof(module) !== 'undefined') {
    module.exports = cache;
}
