var eventable = (superclass) => class extends superclass {
    constructor() {
	super(...arguments);
	this._events = {};
	this._once = {};
	this._state = {};
	this._stateFuncs = {};
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
    once(name, func) {
	if (!this._once.hasOwnProperty(name)) {
	    this._once[name] = new Set();
	}
	this._once[name].add(func);
    }

    onceState(name, func) {
	// Calls once when a state of this object is satisfied, e.g., it's built
	if (this._state[name] === true) {
	    func();
	}
	else {
	    if (!this._stateFuncs.hasOwnProperty(name)) {
		this._stateFuncs[name] = new Set();
	    }
	    this._stateFuncs[name].add(func);
	}
	
    }

    _setState(name, val) {
	// Set the state
	this._state[name] = val;

	// Call the listeners
	if (val && this._stateFuncs.hasOwnProperty(name)) {
	    this._stateFuncs[name].forEach(function(toCall) {
		toCall();
	    });
	    delete this._stateFuncs[name];
	}
    }

    _emit(name, args = []) {
	if (this._events.hasOwnProperty(name)) {
	    this._events[name].forEach(function(toCall) {
		toCall(...args);
	    });
	}
	if (this._once.hasOwnProperty(name)) {
	    this._once[name].forEach(function(toCall) {
		toCall(...args);
	    });
	    // Only do them once
	    delete this._once[name];
	}
    }
};

if (typeof module !== "undefined") {
    module.exports = eventable;
}
