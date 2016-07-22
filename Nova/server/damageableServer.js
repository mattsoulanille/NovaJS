module.exports = damageableServer;
var _ = require("underscore");
var Promise = require("bluebird");
var damageable = require("../client/damageable.js");


function damageableServer(buildInfo, system) {
    damageable.call(this, buildInfo, system);
}

damageableServer.prototype = new damageable;

