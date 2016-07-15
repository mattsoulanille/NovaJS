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

document.onkeydown = function(e) {
    e = e || event;
    blocked_keys = [37, 38, 39, 40, 32, 9];


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





var textures = {}; // global texture object that sprites save and load textures from
var spaceObjects = []; // global rendered spaceObjects
var ships = [];
//var myShip = new playerShip("Starbridge A")
var medium_blaster = new outfit("Medium Blaster", 5);
var myShip = new playerShip("Starbridge A", [medium_blaster]);
//var bar = new statusBar("civilian", myShip);

var starbridge = new ship("Starbridge A");
var shuttle = new ship("Shuttle A");
var dart = new ship("Vell-os Dart");
var stars = new starfield(myShip, 40);

var earth = new planet("Earth");


//var target = new targetImage("Starbridge.png")
//target.build()

//for collisions

ships.push(shuttle);
ships.push(starbridge);
ships.push(dart);
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
var buildShips = _.map(ships, function(s) {return s.build()})
Promise.all(buildShips)
    .then(stars.build.bind(stars))
    .then(myShip.build.bind(myShip))
//    .then(bar.build.bind(bar))
    .then(earth.build.bind(earth))
    .then(function() {readyToRender = true; console.log("built objects")});

function startGame() {

    // for (var i = 0; i < spaceObjects.length; i++) {
    // 	if (!spaceObjects[i].renderReady) {
    // 	    readyToRender = false;
    // 	    console.log("Rendering NOT started")
    // 	}
    // }

    if (readyToRender) {
	//replace with promises
	$.when( spaceObjects.map(function(s){
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


spaceObject.prototype.lastTime = new Date().getTime()
function animate() {
	
    spaceObject.prototype.time = new Date().getTime()

    myShip.render()

    stars.render()
    var lastTimes = []
    _.each(spaceObjects, function(s) {
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
