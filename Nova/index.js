var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);



app.get('/', function(req, res){
    res.sendFile(__dirname + '/index.html');
});

app.use(express.static(__dirname))

io.on('connection', function(socket){
    // socket.on('test', function(msg) {
    // 	console.log(msg);
    // });

    
    console.log('a user connected');
});

http.listen(8000, function(){
    console.log('listening on *:8000');
});
