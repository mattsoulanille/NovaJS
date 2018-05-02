if (typeof(module) !== 'undefined') {
    var ship = require("../server/shipServer.js");
}


class npc extends ship {
    constructor() {
	super(...arguments);
	this.buildInfo.type = "npc";
    }

    // async build() {
    // 	await super.build();
    // }
    _addToSystem() {
	this.system.npcs.add(this);
	super._addToSystem.call(this);
    }

    _removeFromSystem() {
	this.system.npcs.delete(this);
	super._removeFromSystem.call(this);
    }
    onDeath() {
//	this.hide();
    }


}

if (typeof(module) !== 'undefined') {
    module.exports = npc;
}

