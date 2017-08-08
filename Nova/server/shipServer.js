var _ = require("underscore");
var Promise = require("bluebird");
var ship = require("../client/ship.js");

class shipServer extends ship {

    constructor(buildInfo, system) {
	super(...arguments);
    }

    buildTargetImage() {
	return;
    }

    buildDefaultWeapons() {
	// and also send them to the client
    }

    async _build() {
	await super._build();
	await this.buildDefaultWeapons();
	
    }
    
    addSpritesToContainer() {
	
    }

    manageLights() {

    }

    manageEngine() {

    }
}
module.exports = shipServer;
