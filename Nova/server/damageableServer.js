var _ = require("underscore");
var Promise = require("bluebird");
var damageable = require("../client/damageable.js");

let damageableServer = (superclass) => class extends damageable(superclass) {
//    constructor() {
//	super(...arguments);
//    }
}
module.exports = damageableServer;
