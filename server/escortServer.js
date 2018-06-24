if (typeof(module) !== 'undefined') {
    var escort = require("../client/escort.js");
    var AIs = require("./simpleAIs.js");
}

class escortServer extends escort {
    constructor() {
	super(...arguments);
	this.controllers = {
	    attack : new AIs.attackTarget(),
	    defend : new AIs.defend(),
	    holdPosition : new AIs.holdPosition(),
	    formation : new AIs.formation()
	};
	this.updateAI("formation");
    }

    updateAI(orders) {
	this.controller = this.controllers[orders];
    }
};

module.exports = escortServer;
