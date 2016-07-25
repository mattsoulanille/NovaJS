module.exports = outfitServer;
var _ = require("underscore");
var Promise = require("bluebird");
var outfit = require("../client/outfit.js");
var UUID = require('node-uuid');

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

outfitServer.prototype.buildWeapons = function() {
    //makes uuids for the outfit's weapons.
    //assumes this.meta.functions.weapon is a list if defined
//    console.log(this.buildInfo);
    this.buildInfo.UUIDS = {};
    _.each(this.meta.functions.weapon, function(weaponName) {
	this.buildInfo.UUIDS[weaponName] = UUID();
    }.bind(this));
/*    
    if (typeof this.meta.functions.weapon !== 'undefined') {
	this.buildInfo.UUIDS = {};
	var len = this.meta.functions.weapon.length;
	for (i = 0; i < len; i++) {
	    this.buildInfo.UUIDS
	}
    }
*/
    outfit.prototype.buildWeapons.call(this);
}
