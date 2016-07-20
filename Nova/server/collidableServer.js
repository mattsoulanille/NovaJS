module.exports = collidableServer;
var collidable = require("../client/collidable.js");
var _ = require("underscore");
var Promise = require("bluebird");

function collidableServer(name, system) {
    collidable.call(this, name, system);
}

collidableServer.prototype = new collidable;

//collidable is fairly simple
