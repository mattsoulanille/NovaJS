module.exports = planetServer;
var planet = require("../client/planet.js");
//var _ = require("underscore");
//var Promise = require("bluebird");

function planetServer(buildInfo, system) {
    planet.call(this, buildInfo, system);
}

planetServer.prototype = new planet;

planet.prototype.addSpritesToContainer = function() {
}
