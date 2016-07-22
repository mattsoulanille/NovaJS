module.exports = projectileServer;
var _ = require("underscore");
var Promise = require("bluebird");
var projectile = require("../client/projectile.js")

function projectileServer(buildInfo) {
    projectile.call(this, buildInfo);
}

projectileServer.prototype = new projectile;

