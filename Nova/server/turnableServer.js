var turnable = require("../client/turnable.js");
var _ = require("underscore");
var Promise = require("bluebird");

let turnableServer = (superclass) => class extends turnable(superclass) {
    constructor() {
	super(...arguments);

	
    }

    build() {
	return super.build.call(this);
    }

    render() {
	if (this.turning == "left") {
	    this.pointing = this.pointing + (this.properties.turnRate * (this.time - this.lastTime) / 1000);
	}
	else if (this.turning == "right") {
	    this.pointing = this.pointing - (this.properties.turnRate * (this.time - this.lastTime) / 1000);
	}
	this.pointing = (this.pointing + 2*Math.PI) % (2*Math.PI);
	
	super.render.call(this);
	return true;
    }

}
module.exports = turnableServer;
