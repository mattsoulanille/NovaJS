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



function playerShip(shipName, outfits) {
    ship.call(this, shipName, outfits);
    this.pointing = Math.random()*2*Math.PI;
    this.velocity[0] = 0;
    this.velocity[1] = 0;
    this.isPlayerShip = true;
    this.weapons.primary = [];
    this.weapons.secondary = [];
}

playerShip.prototype = new ship

playerShip.prototype.build = function() {
    ship.prototype.build.call(this)

	.then(function() {
	    this.sortWeapons()

	}.bind(this));
}

playerShip.prototype.sortWeapons = function() {

    _.each(this.weapons.all, function(weapon) {

	if (weapon.meta.properties.type === "primary") {
	    this.weapons.primary.push(weapon);
	    
	}
	else if (weapon.meta.properties.type === "secondary") {
	    this.weapons.secondary.push(weapon);
	    
	}

    }.bind(this));
    
}

playerShip.prototype.updateStats = function() {
    var keys = KeyboardJS.activeKeys();
    var turning;
    var accelerating;
    if (_.contains(keys, 'right') && !_.contains(keys, 'left')) {
	turning = 'right';
    }
    else if (_.contains(keys, 'left') && !_.contains(keys, 'right')) {
	turning = 'left';
    }
    else {
	turning = '';
    }
    if (_.contains(keys, 'down')) {
	accelerating = -1;
    }
    else if (_.contains(keys, 'up')) {
	accelerating = 1;
    }
    else {
	accelerating = 0;
    }
    if (_.contains(keys, 'space')) {
	_.map(this.weapons.primary, function(weapon) {weapon.startFiring();});

    }
    else {
	_.map(this.weapons.primary, function(weapon) {weapon.stopFiring();});
    }

    
    ship.prototype.updateStats.call(this, turning, accelerating);

}



var spaceObjects = [];
//var myShip = new playerShip("Starbridge A")
var medium_blaster = new outfit("Medium Blaster", 5);
var myShip = new playerShip("Starbridge A", [medium_blaster]);
var starbridge = new ship("Starbridge A");
var shuttle = new ship("Shuttle A");
var dart = new ship("Vell-os Dart");
var stars = new starfield(myShip, 400);
stars.build()


//var medium_blaster_weapon = new weapon("Medium Blaster", myShip, 2)

//s.build()

spaceObjects[0] = myShip;
spaceObjects[1] = shuttle;
spaceObjects[2] = starbridge;
spaceObjects[3] = dart;
spaceObjects[0].build();
spaceObjects[1].build();
spaceObjects[2].build();
spaceObjects[2].position = [200,200];
spaceObjects[3].build();
spaceObjects[3].position = [-200, -200];
//spaceObjects[4] = stars;
// spaceObjects[4] = medium_blaster
// spaceObjects[4].position = [200,0]
// spaceObjects[4].build()

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
	$.when( spaceObjects.map(function(s){s.startRender()}) ).done(function() {
	    stars.placeAll()
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
}





