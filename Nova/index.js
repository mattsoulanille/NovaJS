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
var system = require("./server/systemServer.js");

var medium_blaster = new outfit("Medium Blaster", 1);
var sol = new system();

//var starbridge = new ship("Starbridge A", [medium_blaster], sol);

var players = {};
var gameTimeout;
var gameloop = function(system) {
    
    // _.each(players, function(player) {
    // 	player.time = new Date().getTime();
    // 	player.render()
    // });
    system.render();

    gameTimeout = setTimeout(function() {gameloop(system)}, 0);
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

var receives = 0;
var transmits = 0;

/* // debugging socket.io io
setInterval(function() {
    console.log("Transmits: ",transmits);
    transmits = 0;
    console.log("Receives: ", receives);
    receives = 0;
}, 1000);
*/

var paused = false;
var playercount = 0;
io.on('connection', function(client){
    receives ++;

    var userid = UUID();
    var owned_uuids = [userid];
    var currentSystem = sol;
    
//    _.each(system.multiplayer, function(obj, key) {systemInfo[key] = obj;})
//    console.log(sol.multiplayer);
    //    console.log(systemInfo);
    var medium_blaster = {
	"name":"Medium Blaster",
	"count":5
    }
    
    var medium_blaster_turret = {
	"name":"Medium Blaster Turret",
	"count": 2
	//temporary. Eventually, the server outfit object will make these
    }

    var ir_missile = {
	"name":"IR Missile Launcher",
	"count": 2
    }
    var heavy_blaster_turret = {
	"name": "Heavy Blaster Turret",
	"count": 2
    }
    var railgun_200mm = {
	"name": "200mm Fixed Railgun",
	"count": 4
    }
/*
    var playerShipType = {
	"UUID":userid
    };
*/
    var flowerOfSpring = {
	"name":"Flower of Spring",
	"count": 1
    }
    var dart = {
	"name": "Vell-os Dart",
	"outfits": [flowerOfSpring]
    }
    
    var Starbridge = {
	"name":"Starbridge A",
	"outfits":[ir_missile, medium_blaster_turret, medium_blaster]
    }
    
    var IDA_Frigate = {
	"name": "IDA Frigate 1170",
	"outfits":[heavy_blaster_turret, railgun_200mm]

    }
    var shipTypes = [Starbridge, IDA_Frigate];
    var playerShipType = shipTypes[_.random(0,shipTypes.length-1)]
    playerShipType.UUID = userid;

    var sendPlayerShip = function() {
//	console.log(myShip.buildInfo.outfits[0])
	client.emit('onconnected', {
	    "playerShip":myShip.buildInfo,
	    "id": userid,
	    "system": currentSystem.getObjects(),
	    "paused": paused
	});
	transmits ++;
    }

    myShip = new ship(playerShipType, currentSystem);
    myShip.build().
	then(function() {
	_.each(myShip.outfitList, function(outf) {
	    _.each(outf.UUIDS, function(uuid) {
		owned_uuids.push(uuid);
	    });
	});
	})
//	.then(function() {console.log(myShip.weapons.all[0].UUID)})
	.then(sendPlayerShip)
	.then(function() {
	    client.broadcast.emit('addObjects', [myShip.buildInfo]);
	    transmits += playercount;
	});

//    console.log(owned_uuids);
//    console.log(playerShipType);


    var myShip;

    players[userid] = myShip;
    playercount = _.keys(players).length;
    console.log('a user connected. ' + playercount + " playing.");
    client.on('updateProjectiles', function(stats) {
	receives ++;
    });
    
    client.on('updateStats', function(stats) {
	receives ++;
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
	transmits += playercount - 1;
//	client.broadcast.emit('test', "does this work?");

	
    });

    client.on("test", function(data) {
	receives ++;
	console.log(data);
    });
    

    //    console.log(client);
//    console.log(userid);

    
    client.on('pingTime', function(msg) {
	receives ++;
    	var response = {};
    	if (msg.hasOwnProperty('time')) {
    	    response.clientTime = msg.time;
    	    response.serverTime = new Date().getTime();
    	    client.emit('pongTime', response);
	    transmits ++;
//	    console.log(msg);
	    

    	}
    });
    client.on('disconnect', function() {
	receives ++;
	client.broadcast.emit('removeObjects', owned_uuids)
	transmits += playercount - 1;
	currentSystem.removeObjects(owned_uuids);

	delete players[userid];
	console.log('a user disconnected. ' + _.keys(players).length + " playing.");
    });
    client.on('pause', function() {
	receives ++;
	paused = true;
	clearTimeout(gameTimeout);
	//	client.broadcast.emit('pause');
	io.emit('pause', {for:'everyone'});
	transmits += playercount;
    });
    client.on('resume', function() {
	receives ++;
	paused = false;
	io.emit('resume', {for:'everyone'});
	transmits += playercount;
	sol.resume();
//	gameTimeout = setTimeout(function() {gameloop(system)}, 0);
    });
});





http.listen(8000, function(){
    console.log('listening on *:8000');
});
