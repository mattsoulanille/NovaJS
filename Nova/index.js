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
    
    _.each(players, function(player) {
	player.time = new Date().getTime();
	player.render()
    });

    setTimeout(function() {gameloop(system)}, 0);
}

//notify clients of
/*
setInterval(function() {


})
*/
/*
setInterval(function() {
    console.log(_.map(players, function(p) {return p.position}))
}, 5000)
*/




app.get('/', function(req, res){
    res.sendFile(__dirname + '/index.html');
});

app.use(express.static(__dirname))


io.on('connection', function(client){
    console.log('a user connected');
    var userid = UUID(); 
    client.emit('onconnected', {id: userid})

    var playerInfo = {};
    
    _.each(players, function(value, key) {
	playerInfo[key] = value.name;
    });

    client.emit('addPlayers', playerInfo)
    
    var myShip = new ship("Starbridge A", [], system);
    myShip.build()
//	.then(function() {players[userid] = myShip;})
//	.then(function() {console.log(players);});
    players[userid] = myShip;

    
//    console.log(playerInfo);

    playerInfo = {};
    playerInfo[userid] = myShip.name;
    client.broadcast.emit('addPlayers', playerInfo);


    
    
    client.on('updateStats', function(stats) {
	var myShip = players[userid];
	myShip.updateStats(stats);
	
	var newStats = {};
	newStats[userid] = stats;
//	console.log(newStats);
	client.broadcast.emit('updateStats', newStats);
//	client.broadcast.emit('test', "does this work?");

	
    });

    client.on("test", function(data) {
	console.log(data);
    });
    

    //    console.log(client);
//    console.log(userid);

    
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
	delete players[userid];
    });
    

});





http.listen(8000, function(){
    console.log('listening on *:8000');
});
