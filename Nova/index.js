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
var system = require("./client/system.js");

var medium_blaster = new outfit("Medium Blaster", 1);
var sol = new system();

//var starbridge = new ship("Starbridge A", [medium_blaster], sol);

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


sol.addObject({'name':'Earth', 'UUID':UUID(), 'type':'planet'});
sol.build();




io.on('connection', function(client){
    console.log('a user connected');
    var userid = UUID();
    var owned_uuids = [userid];
    var currentSystem = sol;
    
//    _.each(system.multiplayer, function(obj, key) {systemInfo[key] = obj;})
//    console.log(sol.multiplayer);
    //    console.log(systemInfo);
    var medium_blaster = {
	"name":"Medium Blaster",
	"count":5,
	"UUIDS":{"Medium Blaster":UUID()}
    }
    
    var medium_blaster_turret = {
	"name":"Medium Blaster Turret",
	"count": 2,
	//temporary. Eventually, the server outfit object will make these
	"UUIDS":{"Medium Blaster Turret":UUID()} 
    }

    var ir_missile = {
	"name":"IR Missile Launcher",
	"count": 4,
	"UUIDS":{"IR Missile":UUID()}
    }

    var playerShipType = {
	"name":"Starbridge A",
	"outfits":[ir_missile, medium_blaster_turret, medium_blaster],
	"UUID":userid
    };


    myShip = new ship(playerShipType, currentSystem);
    myShip.build();
    _.each(myShip.outfitList, function(outf) {
	_.each(outf.UUIDS, function(uuid) {
	    owned_uuids.push(uuid);
	})
	    });

//    console.log(owned_uuids);
//    console.log(playerShipType);

    client.emit('onconnected', {
	"playerShip":playerShipType,
	"id": userid,
	"system": currentSystem.getObjects()
    });

    var playerInfo = {};
    
    _.each(players, function(value, key) {
	playerInfo[key] = value.buildInfo;
    });

    var myShip;

    players[userid] = myShip;
    
    client.broadcast.emit('addObjects', [myShip.buildInfo]);


    client.on('updateProjectiles', function(stats) {
	
    });
    
    client.on('updateStats', function(stats) {
	var filtered_stats = {};
//	console.log(stats)
	_.each(stats, function(newStats, uuid) {
	    if (_.contains(owned_uuids, uuid)) {

		filtered_stats[uuid] = newStats;
	    }
	});
	
//	console.log(filtered_stats);
	//	console.log(newStats);

	client.broadcast.emit('updateStats', filtered_stats);
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
	client.broadcast.emit('removeObjects', owned_uuids)
	currentSystem.removeObjects(owned_uuids);

	delete players[userid];
    });
    

});





http.listen(8000, function(){
    console.log('listening on *:8000');
});
