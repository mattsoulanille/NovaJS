


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
	this.eventNames = new Set();
    }

    getName(name) {
	var formatted = this.UUID + "/" + name;
	this.eventNames.add(formatted);
	return formatted;
    }
    
    on(eventName, toCall) {
	var name = this.getName(eventName);
	this.socket.on(name, toCall);
    }

    off(eventName, toCall) {
	var name = this.getName(eventName);
	this.socket.off(name, toCall);
    }

    emit(eventName, toEmit) {
	var name = this.getName(eventName);
	this.socket.emit(name, toEmit);
    }

    destroy() {
	this.eventNames.forEach(function(name) {
	    // shouldn't matter that it's removing all since UUID is unique
	    this.socket.removeAllListeners(name);
	}.bind(this));
    }

};

if (typeof(module) !== 'undefined') {
    module.exports = multiplayer;
}
