function syncTime(socket, repeat) {
    this.repeat = repeat || 5;
    this.socket = socket;

}

syncTime.prototype.getDifference = function() {
    this.counter = 0;
    this.difference = 0;
    this.socket.removeAllListeners('pongTime');
    this.socket.on('pongTime', this.receive.bind(this));
    this.send();


    
    return new Promise(function(fulfill, reject) {
	var times = 0;

	var check = function(fulfill, reject) {
//	    console.log(times);
	    if (times > 10) {
		reject()

	    }
	    else if (this.counter === this.repeat) {
		console.log(this.difference);
		fulfill(this.difference);
	    }
	    else {
		times ++;
		return setTimeout(check.bind(this, fulfill, reject), 100);
	    }

	}

	check.call(this, fulfill, reject);

    }.bind(this));
    
}

syncTime.prototype.send = function() {
    for (i=0; i < this.repeat; i++) {
	var clientTime = new Date().getTime()
	socket.emit('pingTime', {time: clientTime});
    }

}

syncTime.prototype.receive = function(msg) {
    var time = new Date().getTime()
    var pingTime = time - msg.clientTime;

    // First half of the trip
    var clientToServer = msg.serverTime - (msg.clientTime + pingTime / 2);
    // Second half
    var serverToClient = (msg.serverTime + pingTime / 2) - time;

    var deltaT = (clientToServer + serverToClient) / 2;
//    console.log(deltaT);
    this.difference += deltaT / this.repeat;

    this.counter ++;
}

