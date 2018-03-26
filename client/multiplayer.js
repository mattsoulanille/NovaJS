


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
	this.queryHandlers = {}; // functions that respond to a query.
	this.responseHandlers = {}; // Functions that take a response to fulfill the promise in the query.

	// Yes they need to be defined here beacuse they need to be bound to "this"
	// because see multiplayerServer.js bindSocket function.
	this.eventListener = function(message) {
	    // Events call functions.
	    // Secure in that only the actual owner of the UUID
	    // can cause it to emit events.
	    if (message.name in this.events) {
		this.events[message.name].forEach(function(toCall) {
		    toCall(message.data);
		});
	    }

	}.bind(this);

	this.queryListener = async function(message, socket = this.socket) {
	    // Queries get responded to
	    // Anyone can query about any UUID
	    if (message.UUID === this.UUID) {
		if (this.queryHandlers.hasOwnProperty(message.name)) {
		    
		    // There can only be one 
		    var response = await this.queryHandlers[message.name](message.data);
		    var toEmit = {
			name: message.name,
			data: response,
			//type: "response",
			UUID: this.UUID
		    };
		    // This socket might be a different one than this.socket
		    // when the server is calling this method.
		    socket.emit("response", toEmit);		
		}
		else {
		    throw new Error("no query handler for message " + message.name);
		}		    
	    }
	}.bind(this);

	this.responseListener = function(message) {
	    // Responses fulfill the promises made by queries
	    if (message.UUID === this.UUID) {
		if (this.responseHandlers.hasOwnProperty(message.name)) {
		    this.responseHandlers[message.name].forEach(function(fulfill) {
			fulfill(message.data);
		    });
		    // Erase them since they're done now
		    this.responseHandlers = new Set();
		}
		else {
		    throw new Error("no response handler for message " + message.name);
		}
	    }
	    
	}.bind(this);

	this.socket.on(this.UUID + "event", this.eventListener);
	this._bindQueryListener();
	
    }


    _bindQueryListener() {
	// It sucks to have to do it this way, but it's necessary
	// so that the server can listen to queries about UUID 'a'
	// from UUID 'b'.

	this.socket.on("query", this.queryListener);
	this.socket.on("response", this.responseListener);
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

    // These respond to queries. Their return value is
    // the value that the query promise resolves to.
    onQuery(eventName, toCall) {
	this.queryHandlers[eventName] = toCall;
    }

    offQuery(eventName, toCall) {
	delete this.queryHandlers[eventName];
    }

    query(name, data) {
	// Sends a request to the server and expects a response.
	// Server doesn't rebroadcast it.

	// If multiple queries of the same name are made,
	// the first one to come back is the result for all of them!

	return new Promise(function(fulfill, reject) {
	    var toEmit = {};
	    toEmit.name = name;
	    toEmit.data = data;
	    //toEmit.type = "query";
	    // see _bindQueryListener for why the following is needed:
	    toEmit.UUID = this.UUID;
	    toEmit.replyTo = this.socket.id;

	    if (! this.responseHandlers.hasOwnProperty(name)) {
		this.responseHandlers[name] = new Set();
	    }

	    var successFunction = function(data) {
		clearTimeout(deadline); // we made it
		fulfill(data);
	    };
	    
	    // 10 seconds is the timeout for fulfilling a query
	    var deadline = setTimeout(function() {
		// Failed to get a response in time
		this.responseHandlers[name].delete(successFunction);
		reject(new Error("Query had no response. Name: " + name));
	    }.bind(this), 10000);
	    
	    this.responseHandlers[name].add(successFunction);
	    
	    this.socket.emit("query", toEmit);
	}.bind(this));
    }

    
    emit(eventName, eventData) {
	// Gets rebroadcasted to all connected clients
	var toEmit = {};
	toEmit.name = eventName;
	toEmit.data = eventData;
	this.socket.emit(this.UUID + "event", toEmit);
    }

    
    
    destroy() {
	this.socket.removeAllListeners(this.UUID);
    }

};

if (typeof(module) !== 'undefined') {
    module.exports = multiplayer;
}
