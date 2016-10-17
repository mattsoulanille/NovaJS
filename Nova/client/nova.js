//"use strict";
// create an new instance of a pixi stage
var stage;
var space = new PIXI.Container(0x000000);
var landed = new PIXI.Container(0x000000);

// create a renderer instance
var screenW = $(window).width(), screenH = $(window).height() - 10;
var positionConstant = 1;
//var screenW = 800, screenH = 600;
var renderer = PIXI.autoDetectRenderer(screenW, screenH, {
    resolution: window.devicePixelRatio || 1,
    autoResize: true

});

PIXI.RESOLUTION = window.devicePixelRatio;

$(window).resize(onResize);
// add the renderer view element to the DOM
document.body.appendChild(renderer.view);

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
}


var socket = io();




//var p = PubSub;

var UUID;

var sync = new syncTime(socket)




// global system variable; eventually will become a syst (like sol or wolf 359).
// will be given by the server on client entrance to the system;
var sol = new system();



var textures = {}; // global texture object that sprites save and load textures from
var gameControls = new controls(); // global controls
var players = {};
var myShip;
var stars;
var stagePosition;

var stars;
socket.on('onconnected', function(data) {
    UUID = data.id;
    console.log("Connected to server. UUID: "+UUID);
    myShip = new playerShip(data.playerShip, sol);
    if (stars) {
	stars.attach(myShip);
    }
    else {
	stars = new starfield(myShip, 40);
    }
    sol.setObjects(data.system);
    if (data.paused) {
	pause();
    }
    stars.build()
	.then(gameControls.build.bind(gameControls))
	.then(myShip.build.bind(myShip))
	.then(sol.build.bind(sol))
	.then(function() {
	    console.log("built objects");
	    stagePosition = myShip.position;
//	    console.log(data.stats);
	    sol.updateStats(data.stats);
	    startGame();
	    var newStats = {};
	    newStats[myShip.UUID] = myShip.getStats();
	    socket.emit('updateStats', newStats);
	});
    
    //players[UUID] = myShip;
});

socket.on('disconnect', function() {
    console.log("disconnected");
//    players = {};
    UUID = undefined;
});



socket.on('addObjects', function(buildInfoList) {
    console.log("adding objects ", buildInfoList);
    sol.addObjects(buildInfoList);
    sol.build()
});

socket.on('removeObjects', function(uuids) {
    sol.removeObjects(uuids);
});


socket.on('updateStats', function(stats) {
    //    console.log(stats);
    sol.updateStats(stats);
});

socket.on('test', function(data) {
    console.log(data);
});






var last_keys = KeyboardJS.activeKeys();
document.onkeydown = gameControls.keydown.bind(gameControls);
document.onkeyup = gameControls.keyup.bind(gameControls);

gameControls.onstatechange(function() {
    var newStats = {};
    
});

/*
document.onkeydown = function(e) {
    var e = e || event;
    var blocked_keys = [37, 38, 39, 40, 32, 9, 17];

//    socket.emit('test', "Hey look, i'm a test event");


    switch (e.keyCode) {
    case 9:
	myShip.cycleTarget();
	break;
    case 13:
	fullscreen();
    }
    
    new_keys = KeyboardJS.activeKeys();
    if (!new_keys.equals(last_keys)) {
	myShip.updateStats();

	var newStats = {};
	newStats[myShip.UUID] = myShip.getStats();
	socket.emit('updateStats', newStats);

    }
    last_keys = KeyboardJS.activeKeys();    
    if (_.contains(blocked_keys, e.keyCode)) {
	return false;
    }
    else {
	return true;
    }
}
document.onkeyup = function(e) {

    last_keys = KeyboardJS.activeKeys();
    myShip.updateStats();
    var newStats = {};
    newStats[myShip.UUID] = myShip.getStats();
    socket.emit('updateStats', newStats)

}
*/



var paused = false;

var pause = function() {
    console.log("Game paused");
    paused = true;
}
socket.on('pause', pause);


var resume = function() {
    paused = false;
    sol.resume();
    requestAnimationFrame(animate);
    console.log("Game resumed");
}
socket.on('resume', resume);


function startGame() {

    //replace with promises
    $.when( sol.spaceObjects.map(function(s){
	// improve me
	if (! (s instanceof projectile)) {
	    s.show()
	}
    }) ).done(function() {
	stars.placeAll()
	requestAnimationFrame(animate)
	console.log("Rendering started")
    });


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
stage = space;
function animate() {
    
    spaceObject.prototype.time = new Date().getTime() + timeDifference;

    // in case the server restarted...
    if (myShip.rendering) {
	myShip.render();
    }

    stars.render();
    sol.render();

    
    
    collidable.prototype.crash.check();
    
    renderer.render(stage);
    if (!paused) {
	animateTimeout = setTimeout(requestAnimationFrame( animate ), 0);
    }


}



function onResize() {
    screenW = $(window).width();
    screenH = $(window).height();
    renderer.resize(screenW,screenH);
    //also update the starfield
    stars.resize()
    myShip.statusBar.resize()
}




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
