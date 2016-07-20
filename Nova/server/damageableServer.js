module.exports = damageableServer;
var _ = require("underscore");
var Promise = require("bluebird");
var damageable = require("../client/damageable.js");


function damageableServer(name, system) {
    damageable.call(this, name, system);
}

damageableServer.prototype = new damageable;

