module.exports = spriteServer;
var _ = require("underscore");
var Promise = require("bluebird");
var sprite = require("../client/sprite.js");


function spriteServer(url, anchor) {
    sprite.call(this, url, anchor);
}

spriteServer.prototype = new sprite;

spriteServer.prototype.build = function() {
    
    return this.loadResourecs()
	.then(this.onAssetsLoaded.bind(this));

}

spriteServer.prototype.loadResources = function() {
    return new Promise(function(fulfill, reject) {
	var spriteImageInfo = require("../" + this.url);
	fulfill(spriteImageInfo);

    }.bind(this));
}

spriteServer.prototype.setTextures = function() {
    
}

spriteServer.prototype.onAssetsLoaded = function() {
    this.renderReady = true;
}
