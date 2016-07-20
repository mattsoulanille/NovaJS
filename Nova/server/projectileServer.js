module.exports = projectileServer;
var _ = require("underscore");
var Promise = require("bluebird");
var projectile = require("../client/projectile.js")

function projectileServer(name, meta, source) {
    projectile.call(this, name, meta, source);
}

projectileServer.prototype = new projectile;

