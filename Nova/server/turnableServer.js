module.exports = turnableServer;
var turnable = require("../client/turnable.js");
var _ = require("underscore");
var Promise = require("bluebird");
var damageable = require("../server/damageableServer.js");

function turnableServer(name, system) {
    turnable.call(this, name, system);
}

turnableServer.prototype = new turnable;

turnableServer.prototype.build = function() {
    return damageable.prototype.build.call(this);
}

turnableServer.prototype.render = function() {
    if (this.turning == "left") {
	this.pointing = this.pointing + (this.properties.turnRate * (this.time - this.lastTime) / 1000);
    }
    else if (this.turning == "right") {
	this.pointing = this.pointing - (this.properties.turnRate * (this.time - this.lastTime) / 1000);
    }
    this.pointing = (this.pointing + 2*Math.PI) % (2*Math.PI);
    
    damageable.prototype.render.call(this);
    return true;
}
