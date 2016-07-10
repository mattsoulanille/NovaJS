// create an new instance of a pixi stage
var stage = new PIXI.Stage(0x000000);

// create a renderer instance
var screenW = $(window).width(), screenH = $(window).height() - 10;
var positionConstant = 1;
//var screenW = 800, screenH = 600;
var renderer = PIXI.autoDetectRenderer(screenW, screenH);
$(window).resize(onResize);
// add the renderer view element to the DOM
document.body.appendChild(renderer.view);

var p = PubSub;

document.onkeydown = function(e) {
    e = e || event;
    blocked_keys = [37, 38, 39, 40, 32];

    myShip.updateStats();

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
var starbridge = new ship("Starbridge A");
var shuttle = new ship("Shuttle A");
var dart = new ship("Vell-os Dart");
var stars = new starfield(myShip, 40);
stars.build()


//var medium_blaster_weapon = new weapon("Medium Blaster", myShip, 2)

//s.build()

//for collisions
ships[0] = myShip;
ships[1] = shuttle;
ships[2] = starbridge;
ships[3] = dart;
ships[1].position = [100,100]
ships[2].position = [200,200];
ships[3].position = [-200, -200];

_.each(ships, function(ship) {
    ship.build()

});


var startGameTimer = setInterval(function () {startGame()}, 500);

//var printmyShip = setInterval(function() {console.log(myShip)}, 1000)

/*
Starts the game if everything is ready to render.
*/

var stagePosition = myShip.position
function startGame() {
    var readyToRender = true;
    for (var i = 0; i < spaceObjects.length; i++) {
	if (!spaceObjects[i].renderReady) {
	    readyToRender = false;
	    console.log("Rendering NOT started")
	}
    }
    if (readyToRender) {
	//replace with promises
	$.when( spaceObjects.map(function(s){s.show()}) ).done(function() {
	    stars.placeAll()
	    requestAnimationFrame(animate)
	    clearInterval(startGameTimer)
	    console.log("Rendering started")
	});

    }
}

//requestAnimationFrame(animate)


function animate() {
	
    spaceObject.prototype.time = new Date().getTime()
    myShip.render()
    stars.render()
    _.each(spaceObjects, function(s) {
	if (s.rendering) {
	    s.render()
	}
    })

    
    renderer.render(stage)
    requestAnimationFrame( animate ) 


}

var line = new PIXI.Graphics()
stage.addChild(line)


function onResize() {
    screenW = $(window).width();
    screenH = $(window).height();
    renderer.resize(screenW,screenH);
    //also update the starfield
    stars.resize()
}





