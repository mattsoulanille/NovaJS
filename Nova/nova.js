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


function playerShip(shipName) {
    ship.call(this, shipName)
    this.pointing = Math.random()*2*Math.PI
    this.velocity[0] = 0
    this.velocity[1] = 0
    this.isPlayerShip = true
}

playerShip.prototype = new ship

playerShip.prototype.onAssetsLoaded = function() {
    if (spaceObject.prototype.onAssetsLoaded.call(this)) {
	console.log("and it's mine")
    }
}

playerShip.prototype.updateStats = function() {
    var keys = KeyboardJS.activeKeys()
    var turning
    var accelerating
    if (_.contains(keys, 'right') && !_.contains(keys, 'left')) {
	turning = 'right'
    }
    else if (_.contains(keys, 'left') && !_.contains(keys, 'right')) {
	turning = 'left'
    }
    else {
	turning = ''
    }
    if (_.contains(keys, 'down')) {
	accelerating = -1
    }
    else if (_.contains(keys, 'up')) {
	accelerating = 1
    }
    else {
	accelerating = 0
    }
    if (_.contains(keys, 'space')) {
	//medium_blaster.fire(this.pointing, this.position, this.velocity);
    }

    
    ship.prototype.updateStats.call(this, turning, accelerating)

}



var spaceObjects = []
//var myShip = new playerShip("Starbridge A")
var myShip = new playerShip("Starbridge A")
var starbridge = new ship("Starbridge A")
var shuttle = new ship("Shuttle A")
var dart = new ship("Vell-os Dart")
//var medium_blaster = new projectile("Medium Blaster")


spaceObjects[0] = myShip
spaceObjects[1] = shuttle
spaceObjects[2] = starbridge
spaceObjects[3] = dart
spaceObjects[0].build()
spaceObjects[1].build()
spaceObjects[2].build()
spaceObjects[2].position = [200,200]
spaceObjects[3].build()
spaceObjects[3].position = [-200, -200]
//spaceObjects[4] = medium_blaster
//spaceObjects[4].position = [200,0]
//spaceObjects[4].build()

var startGameTimer = setInterval(function () {startGame()}, 1000);

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
	}
    }
    if (readyToRender) {
	//replace with promises
	$.when( spaceObjects.map(function(s){s.startRender()}) ).done(function() {
	    requestAnimationFrame(animate)
	    clearInterval(startGameTimer)
	    console.log("Rendering started")
	});

    }
}

//requestAnimationFrame(animate)

function animate() {
    stagePosition = myShip.position
    spaceObject.prototype.time = new Date().getTime()

    myShip.updateStats()
    renderer.render(stage)
    requestAnimationFrame( animate ) 

    // $.when( spaceObjects.map(function(s){s.updateStats()}) ).done(function() {
    // 	renderer.render(stage)
    // 	requestAnimationFrame( animate ) 

    // });
//    for (var i = 0; i < spaceObjects.length; i++) {
//	spaceObjects[i].updateStats(turning, accelerating)
//    }

/*
// Velocity vector line
    line.clear()
    line.lineStyle(5, 0xFF0000, 1)
    line.moveTo(myShip.sprites.ship.sprite.position.x, myShip.sprites.ship.sprite.position.y)
    line.lineTo(myShip.velocity[0] + myShip.sprites.ship.sprite.position.x, -myShip.velocity[1] + myShip.sprites.ship.sprite.position.y)
*/
    //line.lineTo(300,300)

}

var line = new PIXI.Graphics()
stage.addChild(line)


function onResize() {
    screenW = $(window).width();
    screenH = $(window).height();
    renderer.resize(screenW,screenH);
}





