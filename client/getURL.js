const PIXI = require("pixi.js");
// Must use the PIXI loader since this is used for loading spriteSheets in gameData.js
module.exports = function(url) {
    return new Promise(function(fulfill, reject) {
    var loader = new PIXI.loaders.Loader();
    loader
	.add(url, url)
	.load(function(loader, resource) {
	    if (resource[url].error) {
		reject(resource[url].error);
	    }
	    else {
		fulfill(resource[url].data);
	    }
	});
    });
};
