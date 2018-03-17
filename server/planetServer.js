var planet = require("../client/planet.js");
//var _ = require("underscore");
//var Promise = require("bluebird");

planetServer = class extends planet {
    constructor(buildInfo, system) {
	super(...arguments);
    }

    addSpritesToContainer() {};

    async loadResources(type, id) {
	// temporary until planets can be parsed
	return require("../objects/planets/" + id + ".json");
    }

    buildSpaceport() {};
    
    land() {};
    depart() {};
    assignControls() {};

}
module.exports = planetServer;
