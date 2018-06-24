if (typeof(module) !== 'undefined') {
    var npc = require("../server/npcServer.js");
}

class escort extends npc {
    constructor(buildInfo) {
	super(...arguments);
	this._orders = "";
	if (typeof buildInfo !== "undefined") {
	    this.master = buildInfo.master;
	    // Master should have spaceObject in the prototype chain.
	    // and should have a .escorts object
	}
    }

    _build() {
	super._build();
	this.master.escorts.all.push(this);
    }
    
    get orders() {
	return this._orders;
    }
    set orders(orders) {
	this._setOrders(orders);
    }

    _setOrders(orders) {
	switch (orders) {
	case "attack":
	    this._orders = orders;
	    break;
	case "defend":
	    this._orders = orders;
	    break;
	case "hold position":
	    this._orders = orders;
	    break;
	case "formation":
	    this._orders = orders;
	    break;
	default:
	    throw new Error("Escort given unknown orders: " + orders);
	}
	this.updateAI(orders);
    }

    updateAI() {
	// The server implements this function
    }

    
    getStats() {
	var stats = super.getStats();
	stats.orders = this.orders;
	return stats;
    }

    updateStats(stats) {
	super.updateStats(stats);
	this.orders = stats.orders;
    }
    
    attack() {
	
    }




}

if (typeof(module) !== 'undefined') {
    module.exports = escort;
}
