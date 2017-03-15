var _ = require("underscore");
var Promise = require("bluebird");
var ship = require("../client/ship.js")

class shipServer extends ship {

    constructor(buildInfo, system) {
	super(buildInfo, system);
    }

    buildTargetImage() {
	return;
    }

    addSpritesToContainer() {
	
    }

    manageLights() {

    }
}
module.exports = shipServer;
