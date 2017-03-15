
var _ = require("underscore");
var Promise = require("bluebird");
var acceleratable = require("../client/acceleratable.js");

let acceleratableServer = (superclass) => class extends acceleratable(superclass) {};

module.exports = acceleratableServer;
