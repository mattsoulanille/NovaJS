
Queue = class {
    constructor() {
	this.queue = [];
	this._offset = 0;
	this._firstFree = 0;
	// Note that JS arrays are sparse,
	// so it's ok to have the entire queue
	// be offset by an arbitrary number of cells.
    }

    get length() {
	return this._firstFree - this._offset;
    }
    set length(l) {
	throw new Error("Can not set Queue length directly");
    }
    
    enqueue(item) {
	this.queue[this._firstFree] = item;
	this._firstFree += 1;
    }

    dequeue() {
	if (this.length == 0) {
	    return null;
	}
	else {
	    let item = this.queue[this._offset];
	    delete this.queue[this._offset];
	    this._offset += 1;
	    return item;
	}

    }
    peek() {
	if (this.length == 0) {
	    return null;
	}
	else {
	    return this.queue[this._offset];
	}
    }
};

if (typeof module !== "undefined") {
    module.exports = Queue;
}
