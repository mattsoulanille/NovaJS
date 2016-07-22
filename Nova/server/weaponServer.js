module.exports = weaponServer;
var _ = require("underscore");
var Promise = require("bluebird");
var weapon = require("../client/weapon.js")

function weaponServer(buildInfo) {
    weapon.call(this, buildInfo);

}

weaponServer.prototype = new weapon;

weaponServer.prototype.loadResources = function() {
    return new Promise(function(fulfill, reject) {
	var url = "../" + this.url + this.name + ".json";

	this.meta = require(url);

	if ((typeof(this.meta) !== 'undefined') && (this.meta !== null)) {
	    fulfill();
	}
	else {
	    reject();
	}


    }.bind(this));

}
