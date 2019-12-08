var _ = require("underscore");
var Promise = require("bluebird");
var projectile = require("../client/projectile.js");

class projectileServer extends projectile {
    constructor(buildInfo) {
	super(...arguments);
    }

    buildParticles() {

    }
    async buildExplosion() {

    }
    buildExplosion() {}
}
    


module.exports = projectileServer;
