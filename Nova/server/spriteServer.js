module.exports = spriteServer;
var _ = require("underscore");
var Promise = require("bluebird");
var sprite = require("../client/sprite.js");
var path = require("path");
var appDir = path.dirname(require.main.filename);

function spriteServer(url, anchor) {
    sprite.call(this, url, anchor);
}

spriteServer.prototype = new sprite;

spriteServer.prototype.build = function() {
    
    return this.loadResources()
	.then(this.onAssetsLoaded.bind(this));

}

spriteServer.prototype.loadResources = function() {
    return new Promise(function(fulfill, reject) {
	//	console.log(this.url);
	//	console.log(appDir);
//	console.log(this.url);
	var spriteImageInfo = require(path.join(appDir, this.url));
//	var spriteImageInfo = require(this.url);
	this.spriteImageInfo = spriteImageInfo;
	fulfill(spriteImageInfo);

    }.bind(this));
}

spriteServer.prototype.setTextures = function() {
    
}

spriteServer.prototype.onAssetsLoaded = function() {
    
    this.renderReady = true;
}

spriteServer.prototype.destroy = function() {}
