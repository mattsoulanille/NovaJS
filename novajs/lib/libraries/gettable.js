class gettable {
    constructor(getFunction) {
	this.data = {};
	this.getFunction = getFunction;
    }

    async get(thing) {
	if (! (thing in this.data) ) {
	    this.data[thing] = this.getFunction(thing);
	}

	return await this.data[thing];
    }
};

module.exports = gettable;
