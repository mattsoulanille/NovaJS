//"use strict";
const SPACE_DIM = [7000, 7000]; // dimensions of every system

const PIXI = require("pixi.js");
require("pixi-display");
const socket = require("socket.io-client")();
const novaCache = require("./client/novaCache.js");
const inSystem = require("./client/inSystem.js");
const statusBar = require("./client/statusBar.js");
const system = require("./client/system.js");
const controls = require("./client/controls.js");
const spaceObject = require("./client/spaceObject.js");
const basicWeapon = require("./client/basicWeapon.js");
const beamWeapon = require("./client/beamWeapon.js");
const projectile = require("./client/projectile.js");
const playerShip = require("./client/playerShip.js");
const starfield = require("./client/starfield.js");
const menu = require("./client/menu.js");
//const system = require("./server/systemServer.js");


global.app = new PIXI.Application({
    resolution: window.devicePixelRatio || 1,
    autoResize: true,
    width: window.innerWidth,
    height: window.innerHeight
});

document.body.appendChild(global.app.view);


global.spaceportContainer = new PIXI.Container(0x000000);
global.space = new PIXI.Container(0x000000);

global.app.stage.addChild(global.space);
global.app.stage.addChild(global.spaceportContainer);
global.spaceportContainer.visible = false;

global.space.displayList = new PIXI.DisplayList();

var landed = false;
//stage.addChild(space);



// create a renderer instance
//var screenW = window.innerWidth, screenH = window.innerHeight - 10;
var positionConstant = 1;

PIXI.settings.RESOLUTION = window.devicePixelRatio;

var pos = global.app.stage.getBounds(true);
global.screenW = window.innerWidth;
global.screenH = window.innerHeight;
function onResize(evt) {
    global.screenH = evt.currentTarget.innerHeight;
    global.screenW = evt.currentTarget.innerWidth;
    global.app.renderer.resize(global.screenW,global.screenH);

    global.stars.resize(global.screenW, global.screenH);
    global.myShip.statusBar.resize(global.screenW, global.screenH);
    if (!paused) {
	requestAnimationFrame(global.animate);
    }
}

window.onbeforeunload = function() {
    //currentSystem.destroy();
    socket.disconnect();

};

global.fullscreen = function() {
    if(document.documentElement.requestFullscreen) {
	document.documentElement.requestFullscreen();
    } else if(document.documentElement.mozRequestFullScreen) {
	document.documentElement.mozRequestFullScreen();
    } else if(document.documentElement.webkitRequestFullscreen) {
	document.documentElement.webkitRequestFullscreen();
    } else if(document.documentElement.msRequestFullscreen) {
	document.documentElement.msRequestFullscreen();
    }
};

global.UUID;

//var sync = new syncTime(socket);


// caches nova data that is loaded from the server
var nc = new novaCache();
inSystem.prototype.novaData = nc; // is this bad practice?
statusBar.prototype.novaData = nc; // yes it is. It should be set in loadResourecs's prototype chain

// global system variable; eventually will become a syst (like sol or wolf 359).
// will be given by the server on client entrance to the system;
global.currentSystem = new system();



global.gameControls = new controls(); // global controls
var players = {};


// Temporary until there's an actual system for planets knowing
// what ships they have available.


function loadJson(url) {
    return new Promise(function(fulfill, reject) {
	var loader = new PIXI.loaders.Loader();
	var data;
	loader
	    .add('stuff', url)
	    .load(function(loader, resource) {
		data = resource.stuff.data;
	    })
	    .onComplete.add(function() {fulfill(data);});
    });
}


socket.on('onconnected', async function(data) {
    global.UUID = data.id;
    console.log("Connected to server. UUID: "+global.UUID);
    //global.myShip = new playerShip(data.playerShip);

    if (typeof global.stars === 'undefined') {
	global.stars = new starfield(global.myShip, SPACE_DIM);
    }


    if (data.paused) {
	pause();
    }
    await loadJson("/objects/meta/allShips.json")
	.then(function(ships) {
	    // Temporary
	    global.allShips = ships;
	});

    await loadJson("/objects/meta/allOutfits.json")
	.then(function(outfits) {
	    // Temporary
	    global.allOutfits = outfits;
	});

    await global.currentSystem.setObjects(data.system);
    await global.stars.build();
    await global.gameControls.build();
    await global.currentSystem.build();

    global.space.addChildAt(global.currentSystem.container, 0);
    console.log("built objects");
    global.stagePosition = global.myShip.position;
    global.gameControls.pushScope("playerShip"); // allow the player to control their ship
    window.addEventListener('resize', onResize);
    startGame();
    var newStats = {};
    newStats[global.myShip.UUID] = global.myShip.getStats();

});

socket.on('setPlayerShip', function(buildInfo) {
    if (global.myShip) {
	global.myShip.destroy();
    }
    global.myShip = new playerShip(buildInfo, global.currentSystem);
    
    global.stars.attach(global.myShip);
    global.myShip.position = [global.stagePosition[0], global.stagePosition[1]];
    global.stagePosition = global.myShip.position;
    global.myShip.build();
});

socket.on('disconnect', function() {
    console.log("disconnected");
//    players = {};
    global.UUID = undefined;
});



socket.on('buildObjects', function(buildInfoList) {
    console.log("adding objects ", buildInfoList);
    global.currentSystem.buildObjects(buildInfoList);
    //global.currentSystem.build()
});

socket.on('removeObjects', function(uuids) {
    global.currentSystem.destroyObjects(uuids);
});

// this stuff should be in system so it works when there are multiple systems.
// Each system should have a multiplayer that it can send stuff with.

socket.on('noSuchShip', function(response) {
    console.log("no such ship " + response);
});

socket.on('replaceObject', function(buildInfo) {
    console.log("replacing object with " + buildInfo.id);
    global.currentSystem.replaceObject(buildInfo);
});

/*
socket.on('updateStats', function(stats) {
    //    console.log(stats);
    global.currentSystem.updateStats(stats);
});
*/

socket.on('test', function(data) {
    console.log(data);
});




var paused = false;

var pause = function() {
    console.log("Game paused");
    paused = true;
    global.app.ticker.remove(global.animateSpace);
}
socket.on('pause', pause);


var resume = function() {
    paused = false;
    global.currentSystem.resume();
    global.app.ticker.remove(global.animateSpace);
    global.app.ticker.add(global.animateSpace);
    console.log("Game resumed");
}
socket.on('resume', resume);



global.framerate = 60;



function startGame() {

    global.currentSystem.spaceObjects.forEach(function(s) {
        // improve me                                                           
	if (! (s instanceof projectile)) {
            s.show();
        }
    });

    // Don't have it in the ticker more than once
    global.app.ticker.remove(global.animateSpace);
    global.app.ticker.add(global.animateSpace);
    console.log("Rendering started");

}

//requestAnimationFrame(animate)

// the time difference between the server and client clocks
// NOT the ping time.
var timeDifference = 0;
/*
var getTimeUntilSuccess = function() {
    return sync.getDifference().then(function(d) {
	timeDifference = d;
	console.log("Time Difference: ",timeDifference);
    }, function() {setTimeout(getTimeUntilSuccess, 10000)}); // don't ddos the server
}
*/

//setTimeout(getTimeUntilSuccess, 2000);

//setInterval(function() {sync.getDifference().then(function(d) {timeDifference = d})},10000);
//var syncClocksTimer = setInterval(function() {sync.getDifference()
//					      .then(function(d) {timeDifference = d})}, 120000);


system.prototype.socket = socket;
basicWeapon.prototype.socket = socket;
spaceObject.prototype.socket = socket;
beamWeapon.prototype.socket = socket;
menu.prototype.socket = socket;
spaceObject.prototype.lastTime = new Date().getTime();

var animateTimeout;
global.animateSpace = function(tick) {
    
    var time = global.app.ticker.lastTime;
    var delta = global.app.ticker.elapsedMS;
    global.framerate = global.app.ticker.FPS;


    //check this
    global.currentSystem.render(delta, time);
};

global.animateSpaceport = function() {
    
    //renderer.render(global.spaceportContainer);
};

global.animate = global.animateSpace;

// replace this with performance.now()
var lastTime = new Date().getTime();
var time = new Date().getTime();// + timeDifference;







			

// is this actually still necessary? I don't think I use it anywhere anymore
// Also, it's terrible practice
if(Array.prototype.equals) {
    console.warn("Overriding existing Array.prototype.equals. Possible causes: New API defines the method, there's a framework conflict or you've got double inclusions in your code.");
}
// attach the .equals method to Array's prototype to call it on any array
Array.prototype.equals = function (array) {
    // if the other array is a falsy value, return
    if (!array)
	return false;

    // compare lengths - can save a lot of time
    if (this.length != array.length)
	return false;

    for (var i = 0, l=this.length; i < l; i++) {
	// Check if we have nested arrays
	if (this[i] instanceof Array && array[i] instanceof Array) {
	    // recurse into the nested arrays
	    if (!this[i].equals(array[i]))
		return false;
	}
	else if (this[i] != array[i]) {
	    // Warning - two different object instances will never be equal: {x:20} != {x:20}
	    return false;
	}
    }
    return true;
}
// Hide method from for-in loops
Object.defineProperty(Array.prototype, "equals", {enumerable: false});


