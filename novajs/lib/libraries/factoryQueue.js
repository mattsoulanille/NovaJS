if (typeof module !== "undefined") {
    var Queue = require("./Queue");
}

factoryQueue = class {
    constructor(buildFunction, minInQueue=0) {
	// buildFunction is a function that builds a new
	// instance of the object in the queue
	// minInQueue is the number below which the queue will start
	// building more items. It doesn't work yet.
	this.buildFunction = buildFunction;
	this.queue = new Queue;
    }

    async prebuild(n) {
	// prebuild n many items
	for (let i = 0; i < n; i++) {
	    this.enqueue(await this.buildFunction(this.queue.enqueue.bind(this.queue)));
	}
    }

    async peek() {
	if (this.queue.length === 0) {
	    this.enqueue(await this.buildFunction(this.queue.enqueue.bind(this.queue)));
	}
	return this.queue.peek;
    }

    enqueue(item) {
	// usually never used
	this.queue.enqueue(item);
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

    destroy() {
	for (let item = this.queue.dequeue(); item != null; item = this.queue.dequeue()) {
	    item.destroy();
	}
	this.get = this.dequeue = function() {
	    throw new Error("Called method of destroyed factoryQueue");
	};
    }

    
}

if (typeof module !== "undefined") {
     module.exports = factoryQueue;
}
