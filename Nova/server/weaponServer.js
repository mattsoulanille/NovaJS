
var _ = require("underscore");
var Promise = require("bluebird");
var weapon = require("../client/weapon.js")


weaponServer = class extends weapon {
    constructor(buildInfo, source) {
	super(...arguments);
    }

    loadResources() {
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
}
module.exports = weaponServer;
