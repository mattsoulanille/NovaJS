module.exports = guidedServer;
var _ = require("underscore");
var Promise = require("bluebird");
var guided = require("../client/guided.js");

function guidedServer(buildInfo) {
    guided.call(this, buildInfo);
}

guidedServer.prototype = new guided;

