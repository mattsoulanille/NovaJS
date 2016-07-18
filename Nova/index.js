var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var UUID = require('node-uuid');


app.get('/', function(req, res){
    res.sendFile(__dirname + '/index.html');
});

app.use(express.static(__dirname))

var sendTime = function() {
    
}

io.on('connection', function(client){
     client.on('test', function(msg) {
     	console.log(msg);
     });
    

    client.userid = UUID(); // seems like bad practice...
    //    console.log(client);
    console.log(client.userid);
    client.emit('onconnected', {id: client.userid})
    
    client.on('pingTime', function(msg) {
    	var response = {};
    	if (msg.hasOwnProperty('time')) {
    	    response.clientTime = msg.time;
    	    response.serverTime = new Date().getTime();
    	    client.emit('pongTime', response);
//	    console.log(msg);
	    

    	}
    });
    client.on('disconnect', function() {
	console.log('a user disconnected');
    });
    
    console.log('a user connected');
});





http.listen(8000, function(){
    console.log('listening on *:8000');
});
