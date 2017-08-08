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
	    // first is what it's known as, second is the url
		.add(url, url)
		.load(function(loader, resource) {
		    if (resource[url].error) {
			console.log("error in loading");
			reject(resource[url].error);
		    }
		    else {
			fulfill(resource[url].data);
		    }
		});

	}.bind(this));
    }


    get(id) {
	if ( !(this.cached[id]) ) {
	    this.cached[id] = this.getURL(this.prefix_url + id + ".json");
/*
		.then(function() {}, function() {
		    //if rejected, remove it from this.cached
		    console.log("could not get " + id);
		    this.cached[id] = null;
		}.bind(this));
*/
	}

	return this.cached[id];
    }
    



};

if (typeof(module) !== 'undefined') {
    module.exports = cache;
}
