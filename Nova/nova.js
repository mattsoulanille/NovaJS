// create an new instance of a pixi stage
var stage = new PIXI.Stage(0x000000);

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

var p = PubSub;
var socket = io();
var UUID;
socket.on('onconnected', function(data) {
    UUID = data.id;
    console.log("Connected to server. UUID: "+UUID);
});

var sync = new syncTime(socket)


document.onkeydown = function(e) {
    e = e || event;
    blocked_keys = [37, 38, 39, 40, 32, 9, 17];

//    socket.emit('test', "Hey look, i'm a test event");
    myShip.updateStats();

    switch (e.keyCode) {
    case 9:
	myShip.cycleTarget();
	break;
    }
    


    if (_.contains(blocked_keys, e.keyCode)) {
	return false;
    }
    else {
	return true;
    }
}
document.onkeyup = function(e) {
    myShip.updateStats();
}



// global system variable; eventually will become a syst (like sol or wolf 359).
// will be given by the server on client entrance to the system;
var system = {
    "name": "sol",  //for now, we just define a system so the universe works...
    "spaceObjects": [],
    "ships": [],
    "planets": [],
    "collidables": []
};



var textures = {}; // global texture object that sprites save and load textures from
//var myShip = new playerShip("Starbridge A")
var medium_blaster = new outfit("Medium Blaster", 5);
var medium_blaster_t = new outfit("Medium Blaster Turret", 1);
var ir_missile = new outfit("IR Missile Launcher", 4);
var shuttle_missile = new outfit("IR Missile Launcher", 1);
var shuttle_blaster = new outfit("Medium Blaster Turret", 2);
var myShip = new playerShip("Starbridge A", [medium_blaster_t, ir_missile], system);
//var bar = new statusBar("civilian", myShip);

var starbridge = new ship("Starbridge A", [], system);
var shuttle = new ship("Shuttle A", [shuttle_missile, shuttle_blaster], system);
var dart = new ship("Vell-os Dart", [], system);
var stars = new starfield(myShip, 40);

var earth = new planet("Earth", system);


//var target = new targetImage("Starbridge.png")
//target.build()

//for collisions

//have ships do this pushing themselves
system.ships.push(shuttle);
system.ships.push(starbridge);
system.ships.push(dart);
shuttle.position = [100,100]
starbridge.position = [200,200];
dart.position = [-200, -200];

// _.each(ships, function(ship) {
//     ship.build()

// });


var startGameTimer = setInterval(function () {startGame()}, 500);

//var printmyShip = setInterval(function() {console.log(myShip)}, 1000)

/*
Starts the game if everything is ready to render.
*/

// Be careful about reassigning myShip.position
var stagePosition = myShip.position
var readyToRender = false;
//var buildObjects = _.map(spaceObjects, function(s) {return s.build()});
//console.log(buildObjects)
var buildShips = _.map(system.ships, function(s) {return s.build()})
Promise.all(buildShips)
    .then(stars.build.bind(stars))
    .then(myShip.build.bind(myShip))
//    .then(bar.build.bind(bar))
    .then(earth.build.bind(earth))
    .then(function() {readyToRender = true; console.log("built objects")})



function startGame() {

    // for (var i = 0; i < spaceObjects.length; i++) {
    // 	if (!spaceObjects[i].renderReady) {
    // 	    readyToRender = false;
    // 	    console.log("Rendering NOT started")
    // 	}
    // }

    if (readyToRender) {
	//replace with promises
	$.when( system.spaceObjects.map(function(s){
	    // improve me
	    if (! (s instanceof projectile)) {
		s.show()
	    }
	}) ).done(function() {
	    stars.placeAll()
	    requestAnimationFrame(animate)
	    clearInterval(startGameTimer)
	    console.log("Rendering started")
	});

    }
}

//requestAnimationFrame(animate)

// the time difference between the server and client clocks
// NOT the ping time.
var timeDifference = 0;
setTimeout(function() {sync.getDifference().then(function(d) {timeDifference = d})}, 1000);
//var syncClocksTimer = setInterval(function() {sync.getDifference()
//					      .then(function(d) {timeDifference = d})}, 120000);

spaceObject.prototype.lastTime = new Date().getTime()
function animate() {
    
    spaceObject.prototype.time = new Date().getTime() + timeDifference;

    myShip.render()

    stars.render()
    var lastTimes = []
    _.each(system.spaceObjects, function(s) {
    	if (s.rendering) {
    	    s.render()
	    lastTimes.push(s.lastTime)
    	}
    });


    //bar.render()
    
//    times = _.map(lastTimes, function(x) {return myShip.lastTime - x});
//    console.log(times)
//    console.log(_.reduce(function(a,b) {return a && b}, times, true))
    
    renderer.render(stage);

    requestAnimationFrame( animate );


}



function onResize() {
    screenW = $(window).width();
    screenH = $(window).height();
    renderer.resize(screenW,screenH);
    //also update the starfield
    stars.resize()
    myShip.statusBar.resize()
}
