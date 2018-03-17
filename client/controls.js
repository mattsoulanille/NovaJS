class controls {

    constructor(url) {
	this.url = url || "/settings/controls.json";
	//    this.playerShip = playerShip;
	this.scopes = {};
	this.built = false;
	this.eventListenersStart = {};
	this.eventListenersEnd = {};
	this.eventListenersStateChange = [];
	this.activeEvents = {};
	this.blocked_keys = [37, 38, 39, 40, 32, 9, 17];
    }
    
    
    
    


    build() {

	return this.loadJson(this.url)
	    .then(function(data) {
		this.scopes = data;
		this.built = true;
		this.scope = this.scopes.space;
		
		
		Object.values(this.scopes).forEach(function(scope) {
		    Object.values(scope).forEach(function(event) {
			this.activeEvents[event] = false;
		    }.bind(this));
		}.bind(this));
		
	    }.bind(this));
    }

    resetEvents() {
	Object.keys(this.activeEvents).forEach(function(key) {
	    this.activeEvents[key] = false;
	}.bind(this));
    }

    keydown(key) {
	var controlEvent = this.scope[key.keyCode];
	
	if (this.activeEvents[controlEvent] !== true) {
	    this.activeEvents[controlEvent] = true;
	    this.callAll(this.eventListenersStart[controlEvent]);
	    this.statechange();
	}
	
	
	if (_.contains(this.blocked_keys, key.keyCode)) {
	    return false;
	}
	else {
	    return true;
	}
    }

    keyup(key) {
	var controlEvent = this.scope[key.keyCode];
	this.callAll(this.eventListenersEnd[controlEvent]);
	this.activeEvents[controlEvent] = false;
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
	var toCall = this.eventListenersStateChange;
	if (typeof toCall !== "undefined") {
	    toCall.forEach(function(f) {
		f(this.activeEvents);
	    }.bind(this));
	}
    }
    
    onstart(control_event, f) {
	return this.on(this.eventListenersStart, control_event, f);
    }

    onend(control_event, f) {
	return this.on(this.eventListenersEnd, control_event, f);
    }
    
    offstart(control_event, f) {
	return this.off(this.eventListenersStart, control_event, f);
    }

    offend(control_event, f) {
	return this.off(this.eventListenersEnd, control_event, f);
    }
    offall(f) {
	var removeAll = function(list, f) {
	    var index = list.indexOf(f);
	    if (index !== -1) {
		list.splice(index, 1);
	    }
	};

	Object.values(this.eventListenersStart).forEach(function(list) {
	    removeAll(list, f);
	}.bind(this));
	
	Object.values(this.eventListenersEnd).forEach(function(list) {
	    removeAll(list, f);
	}.bind(this));
	
	removeAll(this.eventListenersStateChange, f);
    }
    

    on(eventListeners, control_event, f) {
	if (typeof eventListeners[control_event] === "undefined") {
	    eventListeners[control_event] = [];
	}
	if (!eventListeners[control_event].includes(f)) {
	    eventListeners[control_event].push(f);
	}
	return f;
    }

    off(eventListeners, control_event, f) {
	if (typeof eventListeners[control_event] !== "undefined") {
	    
	    var e = eventListeners[control_event];
	    var index = e.indexOf(f);
	    if (index !== -1) {
		e.splice(index, 1);
	    }
	}
    }
    
    onstatechange(f) {
	var e = this.eventListenersStateChange;
	if (!e.includes(f)) {
	    e.push(f);
	}
	return f;
    }

    offstatechange(f) {
	var e = this.eventListenersStateChange;
	var index = e.indexOf(f);
	if (index !== -1) {
	    e.splice(index, 1);
	}
    }

    // sets the scope the player is in (landed, space etc);
    setControlScope(controlScope) {
	this.controlScope = controlScope;
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
