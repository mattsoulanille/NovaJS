class controls {

    constructor(url) {
	this.url = url || "/settings/controls.json";

	this.keybinds = null;
	this.built = false;

	// eventListenersStart[scope][eventName] = Set()
	this.eventListenersStart = {};
	this.eventListenersEnd = {};
	this.eventListenersStateChange = {};
	this.keyboardState = {};
	this.blocked_keys = [37, 38, 39, 40, 32, 9, 17];

	// Events are only fired if the scope they were created in is active
	//this._scope = [null];
	this.scopes = [null];

    }

    pushScope(s) {
	if (!this.eventListenersStart.hasOwnProperty(s)) {
	    this.eventListenersStart[s] = {};
	}
	if (!this.eventListenersEnd.hasOwnProperty(s)) {
	    this.eventListenersEnd[s] = {};
	}
	this.scopes.push(s);
    }

    popScope() {
	// always keep at least one scope (the null scope)
	if (this.scopes.length > 1) {
	    return this.scopes.pop();
	}
	throw new Error("Scope stack underflow");
    }
    
    set scope(s) {
	throw new Error("Can't set scope directly. Push to the scope stack with pushScope(s).");
    }

    get scope() {
	return this.scopes[this.scopes.length - 1];
    }


    build() {

	return this.loadJson(this.url)
	    .then(function(data) {
		this.keybinds = data;
		this.built = true;
		
		Object.values(this.keybinds).forEach(function(event) {
		    this.keyboardState[event] = false;
		}.bind(this));

		// Assign event listeners for keypresses
		// Writes over other listeners...
		document.onkeydown = this.keydown.bind(this);
		document.onkeyup = this.keyup.bind(this);
	    }.bind(this));

    }

    resetEvents() {
	Object.keys(this.keyboardState).forEach(function(key) {
	    this.keyboardState[key] = false;
	}.bind(this));
    }

    keydown(key) {
	var controlEvents = this.keybinds[key.keyCode];

	if (typeof controlEvents == "undefined") {
	    return true; // unbound key
	}
	
	controlEvents.forEach(function(controlEvent) {
	    if (this.keyboardState[controlEvent] !== true) {
		this.keyboardState[controlEvent] = true;
		this.callAll(this.eventListenersStart[this.scope][controlEvent]);
	    }
	}.bind(this));

	this.statechange();
	if (this.blocked_keys.includes(key.keyCode)) {
	    return false;
	}
	else {
	    return true;
	}

    }

    keyup(key) {
	var controlEvents = this.keybinds[key.keyCode];
	if (typeof controlEvents == "undefined") {
	    return; // unbound key
	}

	controlEvents.forEach(function(controlEvent) {
	    this.callAll(this.eventListenersEnd[this.scope][controlEvent]);
	    this.keyboardState[controlEvent] = false;
	}.bind(this));

	this.statechange();
    }
    
    callAll(toCall) {
	if (typeof toCall !== "undefined") {
	    toCall.forEach(function(f) {
		f();
	    });
	}
    }

    statechange() {
	if (this.eventListenersStateChange.hasOwnProperty(this.scope)) {
	    this.eventListenersStateChange[this.scope].forEach(function(f) {
		f(this.keyboardState);
	    }.bind(this));
	}
    }
    
    onStart(scope, control_event, f) {
	return this._on(scope, this.eventListenersStart, control_event, f);
    }

    onEnd(scope, control_event, f) {
	return this._on(scope, this.eventListenersEnd, control_event, f);
    }
    
    offStart(scope, control_event, f) {
	return this._off(scope, this.eventListenersStart, control_event, f);
    }

    offEnd(scope, control_event, f) {
	return this._off(scope, this.eventListenersEnd, control_event, f);
    }

    offAll(f) {
	var removeFrom = [
	    ...Array.prototype.concat(...Object.values(this.eventListenersStart).map(Object.values)),
	    ...Array.prototype.concat(...Object.values(this.eventListenersEnd).map(Object.values)),
	    ...Object.values(this.eventListenersStateChange)
	];

	removeFrom.forEach(function(s) {
	    s.delete(f);
	});
    }
    

    _on(scope, eventListeners, control_event, f) {
	if (!eventListeners.hasOwnProperty(scope)) {
	    eventListeners[scope] = {};
	}

	var inScope = eventListeners[scope];
	if (!inScope.hasOwnProperty(control_event)) {
	    inScope[control_event] = new Set();
	}

	inScope[control_event].add(f);

	return f;
    }

    _off(scope, eventListeners, control_event, f) {
	if (eventListeners.hasOwnProperty(scope) &&
	    eventListeners[scope].hasOwnProperty(control_event)) {
	    eventListeners[scope][control_event].delete(f);
	}
    }
    
    onStateChange(scope, f) {
	if (!this.eventListenersStateChange.hasOwnProperty(scope)) {
	    this.eventListenersStateChange[scope] = new Set();
	}
	this.eventListenersStateChange[scope].add(f);
	return f;
    }

    offStateChange(scope, f) {
	if (this.eventListenersStateChange.hasOwnProperty(scope)) {
	    this.eventListenersStateChange[scope].delete(f);
	}
    }

    // sets the scope the player is in (landed, space etc);
    setControlScope(controlScope) {
	this.scope = controlScope;
    }

    loadJson(url) {
	return new Promise(function(fulfill, reject) {
	    var loader = new PIXI.loaders.Loader();
	    var data;
	    loader
		.add('controls', url)
		.load(function(loader, resource) {
		    data = resource.controls.data;
		})
		.onComplete.add(function() {fulfill(data)});
	});
    }
    
};
