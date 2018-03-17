var eventable = (superclass) => class extends superclass {
    constructor() {
	super(...arguments);
	this._events = {};
    }

    on(name, func) {
	if (!this._events.hasOwnProperty(name)) {
	    this._events[name] = new Set();
	}

	this._events[name].add(func);
    }
    off(name, func) {
	if (this._events.hasOwnProperty(name)) {
	    this._events[name].delete(func);
	}
    }

    _emit(name, args = []) {
	if (this._events.hasOwnProperty(name)) {
	    this._events[name].forEach(function(toCall) {
		toCall(...args);
	    });
	}
    }
};
