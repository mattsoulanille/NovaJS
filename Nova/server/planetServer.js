module.exports = planetServer;
var planet = require("../client/planet.js");
//var _ = require("underscore");
//var Promise = require("bluebird");

function planetServer(buildInfo, system) {
    planet.call(this, buildInfo, system);
}

planetServer.prototype = new planet;

planetServer.prototype.addSpritesToContainer = function() {
}

planetServer.prototype.land = function() {};
planetServer.prototype.depart = function() {};
planetServer.prototype.assignControls = function() {};
