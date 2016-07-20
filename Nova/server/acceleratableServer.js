module.exports = acceleratableServer;
var _ = require("underscore");
var Promise = require("bluebird");
var acceleratable = require("../client/acceleratable.js");

function acceleratableServer(name, system) {
    acceleratable.call(this, name, system);
}

acceleratableServer.prototype = new acceleratable;

