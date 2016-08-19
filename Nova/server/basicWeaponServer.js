module.exports = basicWeaponServer;
var _ = require("underscore");
var Promise = require("bluebird");
var basicWeapon = require("../client/basicWeapon.js");

function basicWeaponServer(buildInfo, source) {
    basicWeapon.call(this, buildInfo, source);
}

basicWeaponServer.prototype = new basicWeapon;

basicWeaponServer.prototype.build = function() {
    return basicWeapon.prototype.build.call(this)
	.then(function() {
	    this.buildInfo.convexHulls = this.projectiles[0].buildInfo.convexHulls;
	    this.buildInfo.collisionSpriteName = this.projectiles[0].buildInfo.collisionSpriteName;
	    //	    console.log(this.projectiles[0].buildInfo.convexHulls.length);
//	    console.log(this.buildInfo.collisionSpriteName);
	    
	}.bind(this))
}

basicWeaponServer.prototype.notifyServer = function() {};

basicWeaponServer.prototype.destory = function() {};

