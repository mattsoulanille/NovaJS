//"use strict";
var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var UUID = require('node-uuid');
var _ = require("underscore");
var Promise = require("bluebird");
var fs = require('fs'),
    PNG = require('pngjs').PNG;

var repl = require("repl");

var local = repl.start();

local.context.io = io;

var help = function() {
    console.log("Available commands:\n" +
		"help\tprints this help\n" + 
		"list\tlists players\n" +
		"kick(uuid)\tkicks a player by uuid"
	       );
};
Object.defineProperty(local.context, 'help', {set: function(x) {}, get: help});

// lists players


var listPlayers = function() {
    var formatted = {};
    _.each(players, function(p, key) {
	formatted[key] = {"ship":p.ship.name};
    });
    return formatted;
}

Object.defineProperty(local.context, 'list', {set: function(x) {}, get: listPlayers});


// kicks a player
var kick = function(UUID) {
    if (_.includes(Object.keys(players), UUID)) {
	players[UUID].io.disconnect();
    }
}

local.context.kick = kick;

// parses nova files + plug-ins
var novaParse = require("novaParse");
var novaData = require("./parsing/novaData");

var npc = require("./server/npcServer.js");
//npc.prototype.io = io;
var spaceObject = require("./server/spaceObjectServer");
spaceObject.prototype.socket = io;
var beamWeapon = require("./server/beamWeaponServer");
beamWeapon.prototype.socket = io;
var basicWeapon = require("./server/basicWeaponServer");
basicWeapon.prototype.socket = io;
var ship = require("./server/shipServer");
var outfit = require("./server/outfitServer");
var planet = require("./server/planetServer");
var system = require("./server/systemServer.js");
var collidable = require("./server/collidableServer.js");
var medium_blaster = new outfit("Medium Blaster", 1);
var sol = new system();
local.context.sol = sol;
Object.defineProperty(local.context, 'ships', {set: function() {}, get: function() {
    return Array.from(sol.ships);
}});

var convexHullBuilder = require("./server/convexHullBuilder.js");
var path = require('path');

var AI = require("./server/AI.js");
var npcMaker= new AI(sol);

local.context.npcMaker = npcMaker;
npcMaker.makeShip(npcMaker.followAndShoot);

local.context.killNPCs = function() {
    sol.npcs.forEach(function(n) {
	n.destroy();
    });
};

local.context.addNPCs = async function(count) {
    var newNPCs = [];
    for (var i = 0; i < count; i++) {
	var newShip = await npcMaker.makeShip(npcMaker.followAndShoot);
	newNPCs.push(newShip.buildInfo);
    }
    io.emit("buildObjects", newNPCs);
};

var players = {}; // for repl

var gameTimeout;
var gameloop = function(system) {
    
    // _.each(players, function(player) {
    // 	player.time = new Date().getTime();
    // 	player.render()
    // });
    spaceObject.prototype.time = new Date().getTime();
    system.render();
    
    
    gameTimeout = setTimeout(function() {gameloop(system)}, 0);
};


//notify clients of
/*
setInterval(function() {


})
*/

// setInterval(function() {
//     console.log(_.map(players, function(p) {return p.position}))
// }, 5000)


//app.get('/', 

global.convexHulls = {};
local.context.convexHulls = global.convexHulls;

var getConvexHulls = function(url) {
    //console.log(url);
    if ( !(global.convexHulls.hasOwnProperty(url)) ) {
	global.convexHulls[url] = new convexHullBuilder(url).build();
	//console.log(global.convexHulls)
    }
    return global.convexHulls[url];
};


app.get('/objects/:objectType/:jsonUrl/convexHulls.json', function(req, res) {

    var decoded = decodeURI(req.path);
    var objPath = path.normalize(path.join(decoded, '../').slice(0,-1)).slice(1);
//    console.log(objPath);
    getConvexHulls(objPath).then(function(hulls) {
	res.json({"hulls":hulls});
    });

});
/*
var getConvexHull = function(url) {
    if ( !(convexHulls.hasOwnProperty(url)) ) {
	convexHulls[url] = new convexHullBuilder(url).build()
    }

    return convexHulls[url];
    
}
*/
app.get('/', function(req, res){
    res.sendFile(__dirname + '/index.html');
});



app.use(express.static(__dirname));


sol.buildObject({'name':'Earth', 'UUID':UUID(), 'type':'planet'});


//
// Start the game
//
var np = new novaParse("./Nova\ Data");
var nd; // nova data
//var nc; // nova cache (not actually a cache. just 
var startGame = async function() {
    await np.read();
    nd = new novaData(np);
    spaceObject.prototype.novaData = nd;
    nd.build();
    local.context.nd = nd;
    
    
    app.param("spriteSheet", function(req, res, next, id) {
	req.spriteSheet = nd.spriteSheets[id];
	next();


    });
    
    app.get('/objects/spriteSheets/:spriteSheet/image.png', function(req, res) {
	if (req.spriteSheet) {
	    var buf = PNG.sync.write(req.spriteSheet.png);
	    res.send(buf);
	}
	else {
	    res.status(404).send("not found");
	}

    });

    app.get('/objects/spriteSheets/:spriteSheet/frameInfo.json', function(req, res) {
	if (req.spriteSheet) {
	    res.send(req.spriteSheet.frameInfo);
	}
	else {
	    res.status(404).send("not found");
	}

    });

    app.get('/objects/spriteSheets/:spriteSheet/convexHullsTest.json', function(req, res) {
	if (req.spriteSheet) {
	    res.send(req.spriteSheet.convexHulls);
	}
	else {
	    res.status(404).send("not found");
	}

    });

    app.get('/objects/shans/:shan', function(req, res) {
	var id = req.params.shan;
	var s = nd.shans[id];
	if (s) {
	    res.send(nd.shans[id]);
	}
	else {
	    res.status(404).send("not found");
	}
    });

    app.get('/objects/weapons/:weapon', function(req, res) {
	


    });


/*
    app.get('objects/ships/:shipID', function(req, res) {
	// returns ship blueprint from which a ship can be made
	// Not a ship object.
	if 
    });
  */  
    await sol.build();
    console.log("built");
    spaceObject.prototype.lastTime = new Date().getTime();
    gameloop(sol);

};
local.context.startGame = startGame;
startGame().then(function() {}, function(err) {console.log(err)});
    






var receives = 0;
transmits = 0;
local.context.transmits = transmits;
// debugging socket.io io
/*
setInterval(function() {
    console.log("Transmits: ",transmits);
    transmits = 0;
    console.log("Receives: ", receives);
    receives = 0;
}, 1000);
*/

var paused = false;
var playercount = 0;

local.context.players = players;
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
    var hailChaingun = {
	"name":"Hail Chaingun",
	"count":2
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
	"outfits":[heavy_blaster_turret, railgun_200mm, ir_missile]

    }

    var Firebird = {
	"name":"Firebird_Thamgiir",
	//	"outfits": [hailChaingun]
	"outfits": [hailChaingun]
//	"outfits": []
    }

    var shipTypes = {"Firebird":Firebird,
		     "Starbridge":Starbridge,
		     "IDA Frigate":IDA_Frigate};
//		     "Dart":dart};
    var shipList = _.values(shipTypes);
    var playerShipType = shipList[_.random(0,shipList.length-1)];
    //var playerShipType = dart;
    playerShipType.UUID = userid;

    var sendSystem = function() {
	//	console.log(myShip.buildInfo.outfits[0])
	//console.log(currentSystem.getObjects())
	var testSystem = {};
	//testSystem[userid] = myShip.buildInfo; // for testing missing objects

	client.emit('onconnected', {
	    "playerShip":myShip.buildInfo,
	    "id": userid,
	    "system": currentSystem.getObjects(),
	    "stats": _.omit(currentSystem.getStats(), userid),
	    "paused": paused
	});
	transmits ++;
    }
    var myShip;
    var buildShip = function(playerShipType) {
	myShip = new ship(playerShipType, currentSystem);
	return myShip.build()
	    .then(function() {
		_.each(myShip.outfitList, function(outf) {
		    _.each(outf.UUIDS, function(uuid) {
			owned_uuids.push(uuid);
		    });
		});
		myShip.show();
		var filtered_stats = {};
		filtered_stats[userid] = myShip.getStats();
		client.broadcast.emit('updateStats', filtered_stats);
	    });
    //	.then(function() {console.log(myShip.weapons.all[0].UUID)})
    }

    var setShip = function(playerShipType) {
	return buildShip(playerShipType)
    	    .then(function() {
		client.emit('setPlayerShip', myShip.buildInfo);
		transmits += playercount;
	    });
    }
		 

    buildShip(playerShipType)
    	.then(sendSystem);


    //doesn't work yet
    client.on('setShip', function(data) {
	if (_.contains(_.keys(shipTypes), data)) {
	    var shipInfo = shipTypes[data];
	    setShip(shipInfo);
	}
    });
//    console.log(owned_uuids);
//    console.log(playerShipType);




    players[userid] = {"ship":myShip,"io":client};
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
	    else {
		//console.log("client tried to change something it didn't own");
		//console.log("Owned uuids: " + owned_uuids);
		//console.log("Tried to change: " + uuid);
	    }

	});
	
//	console.log(filtered_stats);
	//	console.log(newStats);

	client.broadcast.emit('updateStats', filtered_stats);
	transmits += playercount - 1;
//	client.broadcast.emit('test', "does this work?");
	currentSystem.updateStats(filtered_stats);
	
    });

    client.on("test", function(data) {
	receives ++;
	console.log("test:");
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

    client.on('getMissingObjects', function(missing) {
	var toSend = {};
	_.each(missing, function(uuid) {
	    if (currentSystem.multiplayer.hasOwnProperty(uuid)) {
//		console.log("Sending missing object: "+uuid);
		toSend[uuid] = currentSystem.multiplayer[uuid].buildInfo;
	    }
	    else {
		console.log("player " + userid + " requested nonexistant object " + uuid);
	    }
	});

	client.emit('buildObjects', toSend);
    });
    client.on('land', function() {
	receives ++;
	client.broadcast.emit('removeObjects', owned_uuids);
	transmits += playercount - 1;
	currentSystem.removeObjects(owned_uuids);
	// make sure this destroys them (it doesn't right now)
	owned_uuids = [userid];
    });
    client.on('depart', function() {
	playerShipType = shipList[_.random(0,shipList.length-1)];
	playerShipType.UUID = userid;
	
	setShip(playerShipType);
	receives ++;
	//client.broadcast.emit('addObjects', [myShip.buildInfo])
	//var stats = {};
	//stats[userid] = myShip.getStats();
	//client.broadcast.emit('updateStats', stats);
	//transmits += playercount - 1;
    });
    
    client.on('disconnect', function() {

	receives ++;
	client.broadcast.emit('removeObjects', owned_uuids);
	transmits += playercount - 1;

	currentSystem.destroyObjects(owned_uuids);
	console.log("disconnected");

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




var port = 8000;
http.listen(port, function(){
    console.log('listening on *:'+port);
});
