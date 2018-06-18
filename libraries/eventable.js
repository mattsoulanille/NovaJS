var eventable = (superclass) => class extends superclass {
    constructor() {
	super(...arguments);

	// In case the object is made eventable multiple times.
	if (typeof this._has_eventable_defined == 'undefined' &&
	    !this._has_eventable_defined) {
	    this._has_eventable_defined = true;
	    this._events = {};
	    this._once = {};
	    this._state = {};
	    this._onceStateFuncs = {};
	    this._stateFuncs = {};
	}
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
	    if (!this._onceStateFuncs.hasOwnProperty(name)) {
		this._onceStateFuncs[name] = {};
	    }
	    if (!this._onceStateFuncs[name].hasOwnProperty(value)) {
		this._onceStateFuncs[name][value] = new Set();
	    }
	    
	    this._onceStateFuncs[name][value].add(func);
	}
	
    }

    onState(name, func, value = true) {
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

	if (this._onceStateFuncs.hasOwnProperty(name)) {
	    if (this._onceStateFuncs[name].hasOwnProperty(value)) {
		this._onceStateFuncs[name][value].delete(func);
	    }
	}
    }

    setState(name, val) {
	// Set the state
	var previous = this._state[name];
	this._state[name] = val;

	// Call the listeners
	if (this._onceStateFuncs.hasOwnProperty(name) &&
	    this._onceStateFuncs[name].hasOwnProperty(val)) {

	    this._onceStateFuncs[name][val].forEach(function(toCall) {
		toCall();
	    });
	    delete this._onceStateFuncs[name][val];
	}

	if (previous !== val &&
	    this._stateFuncs.hasOwnProperty(name) &&
	    this._stateFuncs[name].hasOwnProperty(val)) {

	    this._stateFuncs[name][val].forEach(function(toCall) {
		toCall();
	    });
	}

	
	
    }

    emit(name) {
	var args = [...arguments].slice(1);
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
