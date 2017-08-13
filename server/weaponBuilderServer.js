
var _ = require("underscore");
var Promise = require("bluebird");
var weaponBuilder = require("../client/weaponBuilder.js");


var weaponBuilderServer = class extends weaponBuilder {
    constructor(buildInfo, source) {
	super(...arguments);
    }

};
module.exports = weaponBuilderServer;
