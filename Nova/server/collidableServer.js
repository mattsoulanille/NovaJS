module.exports = collidableServer;
var collidable = require("../client/collidable.js");
var _ = require("underscore");
var Promise = require("bluebird");

function collidableServer(buildInfo, system) {
    collidable.call(this, buildInfo, system);
}

collidableServer.prototype = new collidable;

//collidable is fairly simple
