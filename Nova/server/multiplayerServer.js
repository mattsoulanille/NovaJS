
var multiplayer = require("../client/multiplayer.js");

var multiplayerServer = class extends multiplayer {
    constructor() {
	super(...arguments);
	this.setListeners();

    }
    broadcast(eventName, toEmit) {
	var name = this.getName(eventName);
	this.socket.broadcast.emit(name, toEmit);
    }

    setListeners() {
	this.on('updateStats', function(newStats) {
	    this.broadcast('updateStats', newStats);
	}.bind(this));
    }

};

module.exports = multiplayerServer;
