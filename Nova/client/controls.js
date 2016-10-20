function controls(url) {
    this.url = url || "/settings/controls.json";
    this.playerShip = playerShip;
    this.scopes = {};
    this.built = false;
    this.eventListenersStart = {};
    this.eventListenersEnd = {};
    this.eventListenersStateChange = [];
    this.activeEvents = {};
}




controls.prototype.blocked_keys = [37, 38, 39, 40, 32, 9, 17];

controls.prototype.build = function() {

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

controls.prototype.keydown = function(key) {
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

controls.prototype.keyup = function(key) {
    var controlEvent = this.scope[key.keyCode];
    this.callAll(this.eventListenersEnd[controlEvent]);
    this.activeEvents[controlEvent] = false;
    this.statechange();
}

controls.prototype.callAll = function(toCall) {
    if (typeof toCall !== "undefined") {
	toCall.forEach(function(f) {
	    f();
	});
    }
}

controls.prototype.statechange = function() {
    var toCall = this.eventListenersStateChange;
    if (typeof toCall !== "undefined") {
	toCall.forEach(function(f) {
	    f(this.activeEvents);
	}.bind(this));
    }
}

controls.prototype.onstart = function(control_event, f) {
    return this.on(this.eventListenersStart, control_event, f);
}

controls.prototype.onend = function(control_event, f) {
    return this.on(this.eventListenersEnd, control_event, f);
}

controls.prototype.offstart = function(control_event, f) {
    return this.off(this.eventListenersStart, control_event, f);
}

controls.prototype.offend = function(control_event, f) {
    return this.off(this.eventListenersEnd, control_event, f);
}



controls.prototype.on = function(eventListeners, control_event, f) {
    if (typeof eventListeners[control_event] === "undefined") {
	eventListeners[control_event] = [];
    }
    if (!eventListeners[control_event].includes(f)) {
	eventListeners[control_event].push(f);
    }

}

controls.prototype.off = function(eventListeners, control_event, f) {
    if (typeof eventListeners[control_event] !== "undefined") {

	var e = eventListeners[control_event];
	var index = e.indexOf(f);
	if (index !== -1) {
	    e.splice(index, 1);
	}
    }
}

controls.prototype.onstatechange = function(f) {
    var e = this.eventListenersStateChange;
    if (!e.includes(f)) {
	e.push(f);
    }
}
controls.prototype.offstatechange = function(f) {
    var e = this.eventListenersStateChange;
    var index = e.indexOf(f);
    if (index !== -1) {
	e.splice(index, 1);
    }
}


// sets the scope the player is in (landed, space etc);
controls.prototype.setControlScope = function(controlScope) {
    this.controlScope = controlScope;
}

controls.prototype.loadJson = function(url) {
    return new Promise(function(fulfill, reject) {
	var loader = new PIXI.loaders.Loader();
	var data;
	loader
	    .add('controls', url)
	    .load(function(loader, resource) {
		data = resource.controls.data;
	    })
	    .once('complete', function() {fulfill(data)});
    });
}

//controls.prototype.
