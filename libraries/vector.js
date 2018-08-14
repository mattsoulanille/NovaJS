class vector {
    constructor(x,y) {
	if (arguments.length !== 2) {
	    throw new Error("Wrong number of arguments to position");
	}
	this[0] = x;
	this[1] = y;
    }

    get 0() {
	return this.x;
    }
    set 0(v) {
	this.x = v;
    }

    get 1() {
	return this.y;
    }
    set 1(v) {
	this.y = v;
    }

    *[Symbol.iterator]() {
	yield this.x;
	yield this.y;
    }
};

module.exports = vector;
