module.exports = acceleratableServer;
var _ = require("underscore");
var Promise = require("bluebird");
var acceleratable = require("../client/acceleratable.js");

function acceleratableServer(buildInfo, system) {
    acceleratable.call(this, buildInfo, system);
}

acceleratableServer.prototype = new acceleratable;

