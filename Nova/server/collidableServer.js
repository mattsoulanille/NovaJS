module.exports = collidableServer;
var collidable = require("../client/collidable.js");
var _ = require("underscore");
var Promise = require("bluebird");
var fs = require('fs');
var PNG = require('pngjs').PNG;
var hull = require('./hull.js');
var convexHullBuilder = require('./convexHullBuilder.js');
var path = require('path');
var appDir = path.dirname(require.main.filename);

function collidableServer(buildInfo, system) {
    collidable.call(this, buildInfo, system);
}

collidableServer.prototype = new collidable;

// stops the server from sending bogus updateStats events
collidableServer.prototype.receiveCollision = function(other) {}

collidableServer.prototype.build = function() {

//    console.log(this.url + this.name + ".json");
    return collidable.prototype.build.call(this)
	.then(function() {
//	    var url = this.getCollisionSprite();
//	    return this.getConvexHulls(url);

	}.bind(this))
	.then(function(hulls) {
	    this.convexHulls = hulls;
	}.bind(this))

}


collidableServer.prototype.getConvexHulls = function(url) {
    if ( !(global.convexHulls.hasOwnProperty(url)) ) {
	global.convexHulls[url] = new convexHullBuilder(url).build();
	//console.log(global.convexHulls)
    }
    return global.convexHulls[url];
}
