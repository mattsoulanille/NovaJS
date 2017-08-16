var _ = require("underscore");
var Promise = require("bluebird");
var projectile = require("../client/projectile.js");

class projectileServer extends projectile {
    constructor(buildInfo) {
	super(...arguments);
    }

    build() {
	return super.build.call(this)
	    .then(function() {
		//	    console.log(this.buildInfo.convexHulls.length);
	    }.bind(this));
    }
    buildParticles() {

    }
}
    


module.exports = projectileServer;
