//"use strict";
var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var UUID = require('uuid/v4');
var _ = require("underscore");
var errors = require("./client/errors.js");
var favicon = require("serve-favicon");

//Promise = require("bluebird");

//process.on('unhandledRejection', r => console.log(r));
// This turns incomprehensible promise errors into real stacktraces

var fs = require('fs'),
    PNG = require('pngjs').PNG;

var repl = require("repl");
var local = repl.start();

const settings = JSON.parse(fs.readFileSync("./settings/server.json"));
const port = settings.port;


local.context.io = io;

// parses nova files + plug-ins
var novaParse = require("novaparse");
var novaData = require("./parsing/novaData");
var gameData = require("./server/gameDataServer.js");

var npc = require("./server/npcServer.js");
//npc.prototype.io = io;
var spaceObject = require("./server/spaceObjectServer");
var inSystem = require("./client/inSystem");
var resourcesPrototypeHolder = require("./client/resourcesPrototypeHolder.js");
//spaceObject.prototype.socket = io;
var beamWeapon = require("./server/beamWeaponServer");
beamWeapon.prototype.socket = io;

var basicWeapon = require("./server/basicWeaponServer");
basicWeapon.prototype.socket = io;


 
var ship = require("./server/shipServer");
var outfit = require("./server/outfitServer");
var planet = require("./server/planetServer");
var system = require("./server/systemServer.js");
var collidable = require("./server/collidableServer.js");
var sol;

Object.defineProperty(local.context, 'ships', {set: function() {}, get: function() {
    return Array.from(sol.ships);
}});

var convexHullBuilder = require("./server/convexHullBuilder.js");
var path = require('path');

var AI = require("./server/AI.js");
var npcMaker;


//npcMaker.makeShip(npcMaker.followAndShoot);

local.context.killNPCs = function() {
    sol.npcs.forEach(function(n) {
	n.destroy();
    });
};

var neuralAI = require("./server/neuralAI.js");
var escort = require("./server/escortServer.js");

local.context.addNPCs = async function(count, name=null) {
    var newNPCs = [];
    var id = null;
    if (name !== null) {
	for (let i in allShips) {
	    if (allShips[i].name == name) {
		id = allShips[i].id;
		break;
	    }
	}
	if (id == null) {
	    throw new Error("Ship name " + name + " not found");
	}
    }
    for (var i = 0; i < count; i++) {
	var newShip = await npcMaker.makeShip(new neuralAI(), id);
	newNPCs.push(newShip.buildInfo);
    }
    io.emit("buildObjects", newNPCs);
};

local.context.addEscort = async function(master, name=null) {
    var id = null;
    if (name !== null) {
	for (let i in allShips) {
	    if (allShips[i].name == name) {
		id = allShips[i].id;
		break;
	    }
	}

    }
    if (id == null) {
	throw new Error("Ship name " + name + " not found");
    }

    var buildInfo = {
	id : id,
	master : master
    };
    var newEscort = new escort(buildInfo);
};


var players = {}; // for repl

var gameTimeout;

var gameloop = function(system, lastTime = new Date().getTime()) {
    
    // _.each(players, function(player) {
    // 	player.time = new Date().getTime();
    // 	player.render()
    // });
    var time = new Date().getTime();
    var delta = time - lastTime;

    system.render(delta, time);
    gameTimeout = setTimeout(function() {gameloop(system, time);}, 0);
};


app.get('/', function(req, res){
    res.sendFile(__dirname + '/index.html');
});

app.use(favicon(path.join(__dirname, "/favicon.ico")));


//
// Start the game
//
var gd; // game data


var startGame = async function() {
    resourcesPrototypeHolder.prototype.socket = io;

    gd = new gameData(app);
    await gd.build();
    resourcesPrototypeHolder.prototype.data = gd.data;

    local.context.gd = gd;
    
    sol = new system({id:"nova:130"});
    local.context.sol = sol;

    var tichel = new system({id: "nova:129"});
    local.context.tichel = tichel;

    npcMaker = new AI(sol, io, gd.ids.ships);
    local.context.npcMaker = npcMaker;
    
    io.on('connection', connectFunction);

    app.use("/static", express.static("static"));
    app.use("/settings", express.static("settings"));
    
    await sol.build();
    console.log("finished loading");

    http.listen(port, function(){
	console.log('listening on *:'+port);
    });

    spaceObject.prototype.lastTime = new Date().getTime();
    gameloop(sol);

};
local.context.startGame = startGame;
startGame();

var paused = false;
var playercount = 0;
var multiplayer = require("./server/multiplayerServer.js");
local.context.m = multiplayer.prototype.globalSet;
local.context.players = players;
var connectFunction = function(socket){

    multiplayer.prototype.bindSocket(socket);
    
    var userid = UUID();
    var owned_uuids = [userid];
    var currentSystem = sol;


    var playerShipType = {
	id: gd.ids.ships[_.random(0, gd.ids.ships.length - 1)]
    };
    
    playerShipType.UUID = userid;

    var sendSystem = function() {
	socket.emit('onconnected', {
	    "playerShip":myShip.buildInfo,
	    "id": userid,
	    "system": currentSystem.buildInfo,
	    "systemObjects": currentSystem.getObjects(),
	    "stats": _.omit(currentSystem.getStats(), userid),
	    "paused": paused
	});
    };
    
    var myShip;

    var buildShip = async function(buildInfo) {
	myShip = new ship(buildInfo, currentSystem, socket);

	await myShip.build();
	
	_.each(myShip.outfits, function(outf) {
	    var uuid = outf.UUID;
	    owned_uuids.push(uuid);
	});

	myShip.show();
    };

    var setShip = async function(id) {
	// doesn't work
	var buildInfo = {};
	if (gd.ids.ships.includes(id)) {
	    buildInfo.id = id;
	    buildInfo.UUID = userid;
	    myShip.destroy();
	    await buildShip(buildInfo);
	    io.emit("replaceObject", buildInfo);
	}
	// else if (shipNames[id]) {
	//     buildInfo.id = shipNames[id];
	//     buildInfo.UUID = userid;
	//     myShip.destroy();
	//     await buildShip(buildInfo);
	//     io.emit("replaceObject", buildInfo);
	// }
	else {
	    socket.emit("noSuchShip", id);
	}
    };
		 
	
	
    buildShip(playerShipType)
    	.then(sendSystem)
	.then(function() {
	    var toEmit = {};
	    toEmit[myShip.buildInfo.UUID] = myShip.buildInfo;
	    socket.broadcast.emit('buildObjects', toEmit);
	});
    
    socket.on('setShip', function(id) {
	    setShip(id);
    });

    players[userid] = {"ship":myShip,"io":socket};
    playercount = _.keys(players).length;
    console.log('a user connected. ' + playercount + " playing.");

    
    socket.on("test", function(data) {
	console.log("test:");
	console.log(data);
    });
    

    socket.on('pingTime', function(msg) {
    	var response = {};
    	if (msg.hasOwnProperty('time')) {
    	    response.socketTime = msg.time;
    	    response.serverTime = new Date().getTime();
    	    socket.emit('pongTime', response);
    	}
    });

    socket.on('getMissingObjects', function(missing) {
	var toSend = {};
	_.each(missing, function(uuid) {
	    if (currentSystem.multiplayer.hasOwnProperty(uuid)) {
		toSend[uuid] = currentSystem.multiplayer[uuid].buildInfo;
	    }
	    else {
		console.log("player " + userid + " requested nonexistant object " + uuid);
	    }
	});

	socket.emit('buildObjects', toSend);
    });
    socket.on('disconnect', function() {

	socket.broadcast.emit('removeObjects', owned_uuids);

	currentSystem.destroyObjects(owned_uuids);
	console.log("disconnected");

	delete players[userid];
	console.log('a user disconnected. ' + _.keys(players).length + " playing.");
    });
    socket.on('pause', function() {
	paused = true;
	clearTimeout(gameTimeout);
	//	socket.broadcast.emit('pause');
	io.emit('pause', {for:'everyone'});
    });
    socket.on('resume', function() {
	paused = false;
	io.emit('resume', {for:'everyone'});
	sol.resume();
//	gameTimeout = setTimeout(function() {gameloop(system)}, 0);
    });
};




