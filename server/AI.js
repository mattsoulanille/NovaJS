var npc = require("./npcServer.js");
var inSystem = require("../client/inSystem.js");
var UUID = require('uuid/v4');
var _ = require("underscore");

class AI extends inSystem {
    constructor(system, socket, shipIDs) {
	super(...arguments);
	this.system = system;
	this.socket = socket;
	this.shipIDs = shipIDs;
	this.npcs = new Set();

    }

    async makeShip(controlFunction = function(state) {return state;}) {
	// controlFunction takes state from npc and returns a new state
	var id = this.shipIDs[_.random(0, this.shipIDs.length - 1)];
	var npcShipType = {
	    "id":id,
	    "UUID": UUID()
	};


	var newNPC = new npc(npcShipType, this.system, this.socket);
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
