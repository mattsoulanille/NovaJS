module.exports = guidedServer;
var _ = require("underscore");
var Promise = require("bluebird");
var guided = require("../client/guided.js");

function guidedServer(name, meta, source) {
    guided.call(this, name, meta, source);
}

guidedServer.prototype = new guided;

