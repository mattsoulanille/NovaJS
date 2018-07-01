//"use strict";
var port = 8000;
var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var UUID = require('uuid/v4');
var _ = require("underscore");
var errors = require("./client/errors.js");
var favicon = require("serve-favicon");

Promise = require("bluebird");

process.on('unhandledRejection', r => console.log(r));
// This turns incomprehensible promise errors into real stacktraces

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
};

Object.defineProperty(local.context, 'list', {set: function(x) {}, get: listPlayers});


// kicks a player
var kick = function(UUID) {
    if (_.includes(Object.keys(players), UUID)) {
	players[UUID].io.disconnect();
    }
};

local.context.kick = kick;

// parses nova files + plug-ins
var novaParse = require("novaparse");
var novaData = require("./parsing/novaData");

var npc = require("./server/npcServer.js");
//npc.prototype.io = io;
var spaceObject = require("./server/spaceObjectServer");
var inSystem = require("./client/inSystem");
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
var medium_blaster = new outfit("Medium Blaster", 1);
var sol = new system();
local.context.sol = sol;
Object.defineProperty(local.context, 'ships', {set: function() {}, get: function() {
    return Array.from(sol.ships);
}});

var convexHullBuilder = require("./server/convexHullBuilder.js");
var path = require('path');

var AI = require("./server/AI.js");
var npcMaker;

local.context.npcMaker = npcMaker;
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
    /*
    try {
	system.render(delta, time);
    }
    catch(e) {
	// Catch all nova errors since they are usually not game breaking
	// (if the game starts breaking, look here first)
	Object.values(errors).forEach(function(ErrorType) {
	    if (e instanceof ErrorType) {
		console.warn("Warning: " + e.message);
	    }
	});
    }
    */
    
    gameTimeout = setTimeout(function() {gameloop(system, time);}, 0);
};


app.get('/', function(req, res){
    res.sendFile(__dirname + '/index.html');
});


app.use(favicon(path.join(__dirname, "/favicon.ico")));
app.use(express.static(__dirname));




//
// Start the game
//
var np = new novaParse("./Nova\ Data");
var nd; // nova data
//var nc; // nova cache (not actually a cache. just

// all ships
var shipIDs;
var allShips;
var allOutfits;
var startGame = async function() {
    console.log("Reading nova data");
    try {
	await np.read();
    }
    catch(err) {
	if (err.code === 'ENOENT') {
	    console.log("Missing data files or directory structure. Expected \"" + err.path + "\" to exist.");
	    console.log('Please make sure your nova files are located at "./Nova Data/Nova Files/" and your plug-ins at "./Nova Data/Plug-ins/"');
	    process.exit(1);
	}
	else {
	    throw err;
	}
    }


    shipIDs = Object.keys(np.ids.resources.shïp);
    allShips = [];
    shipIDs.forEach(function(id) {
	allShips.push({name : np.ids.resources.shïp[id].name,
		       id : id});
    });

    npcMaker = new AI(sol, io, shipIDs);

    var outfIDs = Object.keys(np.ids.resources.oütf);
    allOutfits = [];
    outfIDs.forEach(function(id) {
	allOutfits.push({name : np.ids.resources.oütf[id].name,
		       id : id});
    });
    
    
    local.context.shipIDs = shipIDs;

    nd = new novaData(np);
    //await nd.build();
    
    inSystem.prototype.novaData = nd;
    console.log("Parsing nova files and setting up cache");
    nd.build();
    local.context.nd = nd;

    
    
    io.on('connection', connectFunction);

    app.get('/objects/meta/allShips.json', function(req, res) {
	res.send(JSON.stringify(allShips));
    });

    app.get('/objects/meta/allOutfits.json', function(req, res) {
	res.send(JSON.stringify(allOutfits));
    });

    app.get('objects/planets/:planet.json', function(req, res) {
	req.sendFile(res['planet.json']); //temporary
    });


    app.get('/objects/picts/:image.png', async function(req, res) {
	var id = req.params.image;
	var pict = await nd.picts.get(id);
	var buf = PNG.sync.write(pict.png);
	res.send(buf);
    });
    
    app.param("spriteSheet", async function(req, res, next, id) {
	try {
	    req.spriteSheet = await nd.spriteSheets.get(id);
	}
	catch (e) {
	    if (e.message !== "not found in novaParse") {
		throw e;
	    }
	}
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


    app.get('/objects/spriteSheets/:spriteSheet/convexHulls.json', function(req, res) {
	// see app.param("spriteSheet"... above
	if (req.spriteSheet) {
	    var hulls = req.spriteSheet.convexHulls;
	    res.send(hulls);
	}
	else {
	    res.status(404).send("not found");
	}

    });

    app.get('/objects/ships/:ship.json', async function(req, res) {
	var id = req.params.ship;
	var s = await nd.ships.get(id);
	try {
	    res.send(s);
	}
	catch (e) {
	    res.status(404).send("not found");
	    if (e.message !== "not found in novaParse") {
		throw e;
	    }
	}
    });

    app.get('/objects/weapons/:weapon.json', async function(req, res) {
	var id = req.params.weapon;
	try {
	    res.send(await nd.weapons.get(id));
	}
	catch (e) {
	    res.status(404).send("not found");
	    if (e.message !== "not found in novaParse under wëap") {
		throw e;
	    }
	}
    });
    app.get('/objects/outfits/:outfit.json', async function(req, res) {
	var id = req.params.outfit;
	try {
	    res.send(await nd.outfits.get(id));
	}
	catch (e) {
	    res.status(404).send("not found");
	    if (e.message !== "not found in novaParse under oütf") {
		throw e;
	    }
	}
    });


/*
    app.get('objects/ships/:shipID', function(req, res) {
	// returns ship blueprint from which a ship can be made
	// Not a ship object.
	if 
    });
*/

    // Note: figure out why you need to include 'type': 'planet'
    var earth = new planet({'id':'earth', 'UUID':UUID(), 'type': 'planet'}, sol, io);
    var mars = new planet({'id':'mars', 'UUID':UUID(), 'type':'planet', 'position':[900,600]}, sol, io);
    await sol.build();
    console.log("finished loading");

    http.listen(port, function(){
	console.log('listening on *:'+port);
    });

    spaceObject.prototype.lastTime = new Date().getTime();
    gameloop(sol);

};
local.context.startGame = startGame;
startGame();//.then(function() {}, function(err) {console.log(err)});
    






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
var multiplayer = require("./server/multiplayerServer.js");
local.context.m = multiplayer.prototype.globalSet;
local.context.players = players;
var connectFunction = function(client){

    multiplayer.prototype.bindSocket(client);
    
    receives ++;
    var userid = UUID();
    var owned_uuids = [userid];
    var currentSystem = sol;


    var playerShipType = {
	id: shipIDs[_.random(0, shipIDs.length - 1)]
    };


    //playerShipType = {id: "nova:164"}; // Polaris Raven
    //playerShipType = {id: "nova:176"}; // Krypt Pod
    //playerShipType = {id: "nova:128"}; // shuttle
    //playerShipType = {id: "nova:199"}; // Starbridge C
    //playerShipType = {id: "nova:378"}; // Kestrel
    //playerShipType = {id: "nova:157"}; // thunderhead
    //
    //playerShipType = {id: "singularity:418"};
    
    playerShipType.UUID = userid;

    var sendSystem = function() {
	//	console.log(myShip.buildInfo.outfits[0])
	//console.log(currentSystem.getObjects())
	//testSystem[userid] = myShip.buildInfo; // for testing missing objects

	client.emit('onconnected', {
	    "playerShip":myShip.buildInfo,
	    "id": userid,
	    "system": currentSystem.getObjects(),
	    "stats": _.omit(currentSystem.getStats(), userid),
	    "paused": paused
	});
	transmits ++;
    };
    
    var myShip;

    var buildShip = async function(buildInfo) {
	myShip = new ship(buildInfo, currentSystem, client);

	await myShip.build();
	
	_.each(myShip.outfits, function(outf) {
	    var uuid = outf.UUID;
	    owned_uuids.push(uuid);
	});

	myShip.show();
    //	.then(function() {console.log(myShip.weapons.all[0].UUID)})
    };

    var setShip = async function(id) {
	// doesn't work
	var buildInfo = {};
	if (shipIDs.includes(id)) {
	    buildInfo.id = id;
	    buildInfo.UUID = userid;
	    myShip.destroy();
	    await buildShip(buildInfo);
	    io.emit("replaceObject", buildInfo);
	}
	else if (shipNames[id]) {
	    buildInfo.id = shipNames[id];
	    buildInfo.UUID = userid;
	    myShip.destroy();
	    await buildShip(buildInfo);
	    io.emit("replaceObject", buildInfo);
	}
	else {
	    client.emit("noSuchShip", id);
	}
    };
		 
	
	
    buildShip(playerShipType)
    	.then(sendSystem)
	.then(function() {
	    var toEmit = {};
	    toEmit[myShip.buildInfo.UUID] = myShip.buildInfo;
	    client.broadcast.emit('buildObjects', toEmit);
	});
    
    client.on('setShip', function(id) {
	    setShip(id);
    });
//    console.log(owned_uuids);
//    console.log(playerShipType);




    players[userid] = {"ship":myShip,"io":client};
    playercount = _.keys(players).length;
    console.log('a user connected. ' + playercount + " playing.");
    client.on('updateProjectiles', function(stats) {
	receives ++;
    });

    
    client.on("test", function(data) {
	receives ++;
	console.log("test:");
	console.log(data);
    });
    

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
};




