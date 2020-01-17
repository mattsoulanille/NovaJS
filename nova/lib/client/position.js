const C = require("./constants.js");
const SYST_DIMS = C.SYST_DIMS;

const vector = require("../libraries/vector.js");

function mod(a, b) {
    return ((a % b) + b) % b;
}

function centerMod(a, b) {
    return mod(a + b/2,  b) - b/2;
}


class position extends vector {
    constructor(x, y) {
	super(...arguments);
    }

    get 0() {
	return this.x;
    }
    set 0(v) {
	if (isNaN(v)) {
	    throw new Error("Position can't be NaN");
	}
	this.x = centerMod(v, SYST_DIMS[0]);
    }

    get 1() {
	return this.y;
    }
    set 1(v) {
	if (isNaN(v)) {
	    throw new Error("Position can't be NaN");
	}
	this.y = centerMod(v, SYST_DIMS[1]);
    }

    getStagePosition() {
	
	//return [this[0], -this[1]];
	var p0 = centerMod(this[0] - global.myShip.position[0], SYST_DIMS[0]) + global.myShip.position[0];
	var p1 = centerMod(this[1] - global.myShip.position[1], SYST_DIMS[1]) + global.myShip.position[1];

	return [p0, -p1];
    }

    delta(other) {
	return new position(centerMod(other[0] - this[0], SYST_DIMS[0]),
			    centerMod(other[1] - this[1], SYST_DIMS[1]));
    }
    
    distanceSquared(other) {
	var [p0, p1] = this.delta(other);
	return (p0 ** 2 + p1 ** 2);
    }
    distance(other) {
	return this.distanceSquared(other) ** 0.5;
    }

    angle(other) {
	var [p0, p1] = this.delta(other);
	return mod(Math.atan2(p1, p0), 2 * Math.PI);
    }
    
}

module.exports = position;
