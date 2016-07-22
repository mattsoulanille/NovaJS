module.exports = outfitServer;
var _ = require("underscore");
var Promise = require("bluebird");
var outfit = require("../client/outfit.js");

function outfitServer(buildInfo) {
    outfit.call(this, buildInfo);
}

outfitServer.prototype = new outfit;

outfitServer.prototype.loadResources = function() {
    return new Promise(function(fulfill, reject) {
	var url = "../" + this.url + this.name + ".json";
	this.meta = require(url);

	if ((typeof(this.meta) !== 'undefined') && (this.meta !== null)) {
	    //console.log('fulfilling');
	    fulfill();
	    
	}
	else {
	    reject();
	}
    }.bind(this));
}

	

