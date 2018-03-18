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

    onceState(name, func, value = true) {
	// Calls once when a state of this object is satisfied, e.g., it's built
	if (this._state[name] === value) {
	    func();
	}
	else {
	    if (!this._stateFuncs.hasOwnProperty(name)) {
		this._stateFuncs[name] = {};
	    }
	    if (!this._stateFuncs[name].hasOwnProperty(value)) {
		this._stateFuncs[name][value] = new Set();
	    }
	    
	    this._stateFuncs[name][value].add(func);
	}
	
    }

    offState(name, func, value = true) {
	if (this._stateFuncs.hasOwnProperty(name)) {
	    if (this._stateFuncs[name].hasOwnProperty(value)) {
		this._stateFuncs[name][value].delete(func);
	    }
	}
    }

    _setState(name, val) {
	// Set the state
	this._state[name] = val;

	// Call the listeners
	if (this._stateFuncs.hasOwnProperty(name) &&
	    this._stateFuncs[name].hasOwnProperty(val)) {

	    this._stateFuncs[name][val].forEach(function(toCall) {
		toCall();
	    });
	    delete this._stateFuncs[name][val];
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
