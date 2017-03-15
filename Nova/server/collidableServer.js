var collidable = require("../client/collidable.js");
var _ = require("underscore");
var Promise = require("bluebird");
var fs = require('fs');
var PNG = require('pngjs').PNG;
var hull = require('./hull.js');
var convexHullBuilder = require('./convexHullBuilder.js');
var path = require('path');
var appDir = path.dirname(require.main.filename);


let collidableServer = (superclass) => class extends collidable(superclass) {

    constructor() {
	super(...arguments); // get 'this'
    }
    // stops the server from sending bogus updateStats events
    receiveCollision(other) {};

    build() {

	//    console.log(this.url + this.name + ".json");
	return super.build.call(this)
	    .then(function() {
		//	    var url = this.getCollisionSprite();
		//	    return this.getConvexHulls(url);
		
	    }.bind(this))
	    .then(function(hulls) {
		this.convexHulls = hulls;
	    }.bind(this));
    }

    
    getConvexHulls(url) {
	if ( !(global.convexHulls.hasOwnProperty(url)) ) {
	    global.convexHulls[url] = new convexHullBuilder(url).build();
	    //console.log(global.convexHulls)
	}
	return global.convexHulls[url];
    }
    
}

module.exports = collidableServer;
