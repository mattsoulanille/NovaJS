var planet = require("../client/planet.js");
//var _ = require("underscore");
//var Promise = require("bluebird");

planetServer = class extends planet {
    constructor(buildInfo, system) {
	super(buildInfo, system);
    }

    addSpritesToContainer() {};

    land() {};
    depart() {};
    assignControls() {};

}
module.exports = planetServer;
