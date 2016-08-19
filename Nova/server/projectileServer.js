module.exports = projectileServer;
var _ = require("underscore");
var Promise = require("bluebird");
var projectile = require("../client/projectile.js")

function projectileServer(buildInfo) {
    projectile.call(this, buildInfo);
}

projectileServer.prototype = new projectile;




projectileServer.prototype.build = function() {
    return projectile.prototype.build.call(this)
	.then(function() {
//	    console.log(this.buildInfo.convexHulls.length);
	}.bind(this))
}



