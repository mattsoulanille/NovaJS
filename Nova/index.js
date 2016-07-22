var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var UUID = require('node-uuid');
var _ = require("underscore");
var Promise = require("bluebird");


var ship = require("./server/shipServer");
var outfit = require("./server/outfitServer");
var planet = require("./server/planetServer");

var medium_blaster = new outfit("Medium Blaster", 1);
var system = {spaceObjects:[], ships:[], collidables:[], planets:[], multiplayer:{}}
//var starbridge = new ship("Starbridge A", [medium_blaster], system);

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

// setInterval(function() {
//     console.log(_.map(players, function(p) {return p.position}))
// }, 5000)



app.get('/', function(req, res){
    res.sendFile(__dirname + '/index.html');
});

app.use(express.static(__dirname))


var earth = new planet({name:"earth", multiplayer:true,UUID:UUID()}, system);
earth.build()

var playerShipType = {
    "name":"Starbridge A",
    "outfits":{"Medium Blaster Turret":4, "IR Missile Launcher":4},
    "multiplayer": true
};

    
io.on('connection', function(client){
    console.log('a user connected');
    var userid = UUID();

    var systemInfo = {};
//    _.each(system.multiplayer, function(obj, key) {systemInfo[key] = obj;})
    console.log(system.multiplayer);
//    console.log(systemInfo);
    playerShipType.UUID = userid;
    myShip = new ship(playerShipType, system);
    client.emit('onconnected', {
	"playerShip":playerShipType,
	"id": userid
//	"systemInfo": systemInfo
    });

    var playerInfo = {};
    
    _.each(players, function(value, key) {
	playerInfo[key] = value.buildInfo;
    });

    client.emit('addPlayers', playerInfo)
    var myShip;

    players[userid] = myShip;
    playerInfo = {};
    playerInfo[userid] = myShip.buildInfo;
    client.broadcast.emit('addPlayers', playerInfo);

    
    client.on('makeShip', function(buildInfo) {
	buildInfo.UUID = userid;

	myShip.build()
	    // .then(function() {
	    // 	console.log("built ship: ");
	    // 	console.log(myShip);
	    // });

	
    });
    
    
    client.on('updateStats', function(stats) {
	if (typeof(players[userid]) !== 'undefined') {
	    var myShip = players[userid];
	    myShip.updateStats(stats);
	}
	
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
	client.broadcast.emit('removePlayers', [userid])
	delete players[userid];
    });
    

});





http.listen(8000, function(){
    console.log('listening on *:8000');
});
