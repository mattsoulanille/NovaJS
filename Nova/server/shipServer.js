module.exports = shipServer;
var _ = require("underscore");
var Promise = require("bluebird");
var ship = require("../client/ship.js")

function shipServer(name, outfits, system) {
    ship.call(this, name, outfits, system);
}

shipServer.prototype = new ship;

shipServer.prototype.buildTargetImage = function() {
    return;
}

shipServer.prototype.addSpritesToContainer = function() {

}

shipServer.prototype.manageLights = function() {

}
