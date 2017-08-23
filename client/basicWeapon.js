if (typeof(module) !== 'undefined') {
    var _ = require("underscore");
    var Promise = require("bluebird");
    var projectile = require("../server/projectileServer.js");
    var guided = require("../server/guidedServer.js");
    var inSystem = require("./inSystem.js");
    var loadsResources = require("./loadsResources.js");
    var multiplayer = require("../server/multiplayerServer.js");
}




basicWeapon = class extends loadsResources(inSystem) {
    constructor() {
	super(...arguments);
    }

};


if (typeof(module) !== 'undefined') {
    module.exports = basicWeapon;
}
