var npc = require("./npcServer.js");
var inSystem = require("../client/inSystem.js");
var UUID = require('uuid/v4');

class AI extends inSystem {
    constructor(system) {
	super(...arguments);
	this.system = system;

	this.npcs = new Set();

    }

    async makeShip(controlFunction = function(state) {return state;}) {
	// controlFunction takes state from npc and returns a new state
	
	var hailChaingun = {
	    "name":"Hail Chaingun",
	    "count":2
	};
	
	var Firebird = {
	    "name":"Firebird_Thamgiir",
	    "outfits": [hailChaingun],
	    "UUID": UUID()
	};


	var newNPC = new npc(Firebird, this.system);
	await newNPC.build();
	newNPC.controlFunction = controlFunction;
	this.npcs.add(newNPC);
	newNPC.show();
	return newNPC;

    }

    destroyShip(ship) {
	ship.destroy();
    }

    followAndShoot(state) {
	if (state.targets.length > 0) {
	    state.targetIndex = Math.floor(Math.random() * state.targets.length);
	    state.accelerating = true;
	    state.turningToTarget = true;
	    state.firing[0] = Math.random() >= 0.5;
	    //console.log("following");
	    
	}
	else {
	    state.target = -1;
	    state.accelerating = false;
	    state.turning = "";
	    state.firing[0] = false;
	}
	return state;
    }
    
}

module.exports = AI;
