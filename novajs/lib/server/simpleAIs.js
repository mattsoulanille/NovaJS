class attackTarget {
    constructor() {}

    nextState(state) {
	if (state.target) {
	    state.turningToTarget = true;
	    state.accelerating = true;
	    state.firing.fill(true); // set all weapons to fire
	}
	else {
	    state.turningToTarget = false;
	    state.accelerating = false;
	    state.firing.fill(false); // Stop firing
	}
	return state;
    }
}
exports.attackTarget = attackTarget;

class defend {
    constructor() {}

    nextState(state) {
	state.turning = "left"; // temporary
	return state;
    }
}
exports.defend = defend;

class holdPosition {
    constructor() {}

    nextState(state) {
	// This won't work, but it looks different than the other ones.
	state.turning = "right";
	state.turningToTarget = false;
	state.accelerating = false;
	state.firing.fill(false); // Stop firing

	return state;
    }
}
exports.holdPosition = holdPosition;

class formation {
    constructor() {}

    nextState(state) {
	return state;
    }
}
exports.formation = formation;
