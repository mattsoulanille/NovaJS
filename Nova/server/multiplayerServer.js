
var multiplayer = require("../client/multiplayer.js");

var multiplayerServer = class extends multiplayer {
    constructor() {
	super(...arguments);

	this.broadcaster = function(toEmit) {
	    this.socket.broadcast.emit(this.UUID, toEmit);
	}.bind(this);

	this.socket.on(this.UUID, this.broadcaster);

    }

    emit(eventName, eventData) {
	// broadcast to all the clients
	var toEmit = {};
	toEmit.name = eventName;
	toEmit.data = eventData;
	this.socket.broadcast.emit(this.UUID, toEmit);
    }


};

module.exports = multiplayerServer;
