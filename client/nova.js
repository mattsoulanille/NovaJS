//"use strict";

var app = new PIXI.Application({
    resolution: window.devicePixelRatio || 1,
    autoResize: true,
    width: window.innerWidth,
    height: window.innerHeight
});

document.body.appendChild(app.view);


var spaceportContainer = new PIXI.Container(0x000000);
var space = new PIXI.Container(0x000000);

app.stage.addChild(space);
app.stage.addChild(spaceportContainer);
spaceportContainer.visible = false;

space.displayList = new PIXI.DisplayList();

var landed = false;
//stage.addChild(space);




// create a renderer instance
var screenW = $(window).width(), screenH = $(window).height() - 10;
var positionConstant = 1;
//var screenW = 800, screenH = 600;
// var renderer = PIXI.autoDetectRenderer(screenW, screenH, {
//     resolution: window.devicePixelRatio || 1,
//     autoResize: true

// });

PIXI.settings.RESOLUTION = window.devicePixelRatio;



function onResize(evt) {
    screenH = evt.currentTarget.innerHeight;
    screenW = evt.currentTarget.innerWidth;
    app.renderer.resize(screenW,screenH);
    //also update the starfield
    stars.resize(screenW, screenH);
    myShip.statusBar.resize(screenW, screenH);
    if (!paused) {
	requestAnimationFrame(animate);
    }
}

window.onbeforeunload = function() {
    //currentSystem.destroy();
    socket.disconnect();

};

var fullscreen = function() {
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


var socket = io(); // same as io.connect()




//var p = PubSub;

var UUID;

var sync = new syncTime(socket);


// caches nova data that is loaded from the server
var nc = new novaCache();
inSystem.prototype.novaData = nc; // is this bad practice?
statusBar.prototype.novaData = nc; // yes it is. It should be set in loadResourecs's prototype chain

// global system variable; eventually will become a syst (like sol or wolf 359).
// will be given by the server on client entrance to the system;
var currentSystem = new system();







var textures = {}; // global texture object that sprites save and load textures from
var gameControls = new controls(); // global controls
//gameControls.onstart("fullscreen", fullscreen);
var players = {};
var myShip;
var stars;
var stagePosition;

// Temporary until there's an actual system for planets knowing
// what ships they have available.
var allShips;
var allOutfits;
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
    UUID = data.id;
    console.log("Connected to server. UUID: "+UUID);
//    myShip = new playerShip(data.playerShip);

    if (typeof stars === 'undefined') {
	stars = new starfield(myShip, 40);
    }


    if (data.paused) {
	pause();
    }
    await loadJson("/objects/meta/allShips.json")
	.then(function(ships) {
	    // Temporary
	    allShips = ships;
	});

    await loadJson("/objects/meta/allOutfits.json")
	.then(function(outfits) {
	    // Temporary
	    allOutfits = outfits;
	});

    await currentSystem.setObjects(data.system);
    await stars.build();
    await gameControls.build();
    await currentSystem.build();

    space.addChildAt(currentSystem.container, 0);
    console.log("built objects");
    stagePosition = myShip.position;
    gameControls.pushScope("playerShip"); // allow the player to control their ship
    window.addEventListener('resize', onResize);
    startGame();
    var newStats = {};
    newStats[myShip.UUID] = myShip.getStats();

});

socket.on('setPlayerShip', function(buildInfo) {
    if (myShip) {
	myShip.destroy();
    }
    myShip = new playerShip(buildInfo, currentSystem);
    
    stars.attach(myShip);
    myShip.position = [stagePosition[0], stagePosition[1]];
    stagePosition = myShip.position;
    myShip.build();
});

socket.on('disconnect', function() {
    console.log("disconnected");
//    players = {};
    UUID = undefined;
});



socket.on('buildObjects', function(buildInfoList) {
    console.log("adding objects ", buildInfoList);
    currentSystem.buildObjects(buildInfoList);
    //currentSystem.build()
});

socket.on('removeObjects', function(uuids) {
    currentSystem.destroyObjects(uuids);
});

// this stuff should be in system so it works when there are multiple systems.
// Each system should have a multiplayer that it can send stuff with.

socket.on('noSuchShip', function(response) {
    console.log("no such ship " + response);
});

socket.on('replaceObject', function(buildInfo) {
    console.log("replacing object with " + buildInfo.id);
    currentSystem.replaceObject(buildInfo);
});

/*
socket.on('updateStats', function(stats) {
    //    console.log(stats);
    currentSystem.updateStats(stats);
});
*/

socket.on('test', function(data) {
    console.log(data);
});




var paused = false;

var pause = function() {
    console.log("Game paused");
    paused = true;
    app.ticker.remove(animateSpace);
}
socket.on('pause', pause);


var resume = function() {
    paused = false;
    currentSystem.resume();
    app.ticker.remove(animateSpace);
    app.ticker.add(animateSpace);
    console.log("Game resumed");
}
socket.on('resume', resume);


function startGame() {

    currentSystem.spaceObjects.forEach(function(s) {
        // improve me                                                           
	if (! (s instanceof projectile)) {
            s.show();
        }
    });

    stars.placeAll();
    // Don't have it in the ticker more than once
    app.ticker.remove(animateSpace);
    app.ticker.add(animateSpace);
    console.log("Rendering started");

}

//requestAnimationFrame(animate)

// the time difference between the server and client clocks
// NOT the ping time.
var timeDifference = 0;

var getTimeUntilSuccess = function() {
    return sync.getDifference().then(function(d) {
	timeDifference = d;
	console.log("Time Difference: ",timeDifference);
    }, function() {setTimeout(getTimeUntilSuccess, 10000)}); // don't ddos the server
}

setTimeout(getTimeUntilSuccess, 2000);
//setInterval(function() {sync.getDifference().then(function(d) {timeDifference = d})},10000);
//var syncClocksTimer = setInterval(function() {sync.getDifference()
//					      .then(function(d) {timeDifference = d})}, 120000);


system.prototype.socket = socket;
basicWeapon.prototype.socket = socket;
spaceObject.prototype.socket = socket;
beamWeapon.prototype.socket = socket;
spaceObject.prototype.lastTime = new Date().getTime();

var animateTimeout;
var animate = animateSpace;

// replace this with performance.now()
var lastTime = new Date().getTime();
var time = new Date().getTime();// + timeDifference;

// Revise this to use the pixi ticker
function animateSpace(tick) {
    
    var time = app.ticker.lastTime;
    var delta = app.ticker.elapsedMS;

    stars.render(delta);

    //check this
    currentSystem.render(delta, time);

    
    
    //currentSystem.crash.check();
    if (!paused) {
	//animateTimeout = setTimeout(requestAnimationFrame( animate ), 0);
	//requestAnimationFrame( animate );
    }

    //renderer.render(space);
}

function animateSpaceport() {
    
    
    
    //renderer.render(spaceportContainer);
}






			

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


