"use strict";

function aiStep(state) {
    // Paul, feel free to write stuff in here.
    // Feel free to overwrite anything in state.
    // My convention is camel case instead of underscores.
    // By default, this function is called every second. If you want to change that,
    // you'll need to change _delay in npcServer.js
    // To get a ship, do addNPCs(1)
    // To get a specific ship, do addNPCs(1, ship name). It errors if there isn't a ship
    // of that name, but it won't crash.

    // To see what the properties of state are, go to npcServer.js
    // Make sure to run nova with node --inspect index.js so you can
    // open the chrome node debugger at chrome://inspect
    // When npcs die, they're gone forever. You'll need to make new ones.

    if (state.targets.length > 0) {
	state.targetIndex = Math.floor(Math.random() * state.targets.length);
	state.accelerating = true;
	state.turningToTarget = true;
	for (let i in state.firing) {
	    state.firing[i] = Math.random() >= 0.5;
	}
	//console.log("following");
	
    }
    else {
	state.target = -1;
	state.accelerating = false;
	state.turning = "";
	for (let i in state.firing) {
	    state.firing[i] = false;
	}

    }
    return state;

}


module.exports = aiStep;
