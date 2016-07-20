var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var UUID = require('node-uuid');
var _ = require("underscore");
var Promise = require("bluebird");


/*
var PIXI = require("./server/pixistub.js");
var spaceObject = require("./server/spaceObjectServer");
var movable = require("./server/movableServer");
var collidable = require("./server/collidableServer");
var damageable = require("./server/damageableServer");
var turnable = require("./server/damageableServer");
var acceleratable = require("./server/acceleratableServer");
*/
var ship = require("./server/shipServer");
var outfit = require("./server/outfitServer");
//var playerShip = require("./server/playerShip");

var medium_blaster = new outfit("Medium Blaster", 1);
var system = {spaceObjects:[], ships:[], collidables:[]}
var starbridge = new ship("Starbridge A", [medium_blaster], system);

/*
//build all spaceObjects in system
var buildSystem = function(system) {
    var promises = _.each(system.spaceObjects, function(o) {return o.build()});
    return Promise.all(promises);
}
*/


//uuid, ship
var players = {};
var gameloop = function(system) {
    _.each(players, function(player) {player.render()});

    setTimeout(function() {gameloop(system)}, 0);
}






app.get('/', function(req, res){
    res.sendFile(__dirname + '/index.html');
});

app.use(express.static(__dirname))


io.on('connection', function(client){
     client.on('test', function(msg) {
     	console.log(msg);
     });
    

    client.userid = UUID(); // seems like bad practice...
    var myShip = new ship("Starbridge A", [], system);

    myShip.build()
	.then(function() {players[client.userid] = myShip;})
	.then(function() {console.log(players);});


    //    console.log(client);
//    console.log(client.userid);
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
	delete players[client.userid];
    });
    
    console.log('a user connected');
});





http.listen(8000, function(){
    console.log('listening on *:8000');
});
