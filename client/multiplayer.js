


var multiplayer = class {
    // handles some multiplayer communication

    // the whole updateStats thing should probably be
    // revised to go through this.

    // actually maybe not. updateStats as it's written allows for the
    // server to send multiple objects' stats in one socket call

    // Secure because one client can not access another client's socket listeners
    
    constructor(socket, UUID) {
	this.socket = socket;
	this.UUID = UUID;
	this.events = {};

	this.listener = function(event) {
	    if (event.name in this.events) {
		this.events[event.name].forEach(function(toCall) {
		    toCall(event.data);
		});
	    }
	}.bind(this);


	this.socket.on(this.UUID, this.listener);
	
    }
    
    on(eventName, toCall) {
	if ( !(eventName in this.events) ) {
	    this.events[eventName] = new Set();
	}
	this.events[eventName].add(toCall);
    }

    off(eventName, toCall) {
	if (eventName in this.events) {
	    this.events[eventName].delete(toCall);
	}
    }

    emit(eventName, eventData) {
	// tells it to all the clients
	var toEmit = {};
	toEmit.name = eventName;
	toEmit.data = eventData;
	this.socket.emit(this.UUID, toEmit);
    }

    destroy() {
	this.socket.removeAllListeners(this.UUID);
    }

};

if (typeof(module) !== 'undefined') {
    module.exports = multiplayer;
}
