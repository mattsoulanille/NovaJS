var turnable = require("../client/turnable.js");
var _ = require("underscore");
var Promise = require("bluebird");

let turnableServer = (superclass) => class extends turnable(superclass) {
    constructor() {
	super(...arguments);

	
    }

    renderSprite() {} // don't try to render sprites since there aren't any
	
    render() {
	return super.render.call(this);
    }

}
module.exports = turnableServer;
