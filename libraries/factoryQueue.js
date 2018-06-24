if (typeof module !== "undefined") {
    var Queue = require("./Queue");
}

factoryQueue = class {
    constructor(buildFunction) {
	// buildFunction is a function that builds a new
	// instance of the object in the queue
	this.buildFunction = buildFunction;
	this.queue = new Queue;
    }

    get() {
	return this.dequeue();
    }

    async dequeue() {
	if (this.queue.length > 0) {
	    return this.queue.dequeue();
	}
	else {
	    return await this.buildFunction(this.queue.enqueue.bind(this.queue));
	}
    }
}

if (typeof module !== "undefined") {
     module.exports = factoryQueue;
}
