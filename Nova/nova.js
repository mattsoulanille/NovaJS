// create an new instance of a pixi stage
var stage = new PIXI.Stage(0x000000)

// create a renderer instance
var screenW = $(window).width(), screenH = $(window).height() - 10
//var screenW = 800, screenH = 600;
var renderer = PIXI.autoDetectRenderer(screenW, screenH)
$(window).resize(onResize)
// add the renderer view element to the DOM
document.body.appendChild(renderer.view)



function stagePosition(x, y) { //where x and y are absolute positions in the universe
//    stageX = 







}



function ship(shipName) {
    this.name = shipName || ""
    this.renderReady = false
    this.lastAccelerating = false
}

ship.prototype.build = function() {
    //console.log(this.name)
    var url = "ships/" + this.name + '.json'
    var loader = new PIXI.JsonLoader(url);
    loader.on('loaded', _.bind(this.interpretShipJsonAndStartInterpretShipImageJson, this))
    loader.load()
}

ship.prototype.interpretShipJsonAndStartInterpretShipImageJson = function(evt) {
    //data is in evt.content.json
    this.meta = evt.content.json //generic ship infromation. Not Graphics.
    console.log(this.meta)	// DEBUG
    
    var url = "ships/" + this.meta.imageAssetsFile
    var loader = new PIXI.JsonLoader(url)
    console.log('loading ships/' + this.meta.imageAssetsFile) //DEBUG

    loader.on('loaded', _.bind(this.interpretShipImageJson, this))
    loader.load()
}
ship.prototype.interpretShipImageJson = function(evt) {
    this.shipImageInfo = evt.content.json
    console.log(this.shipImageInfo.meta.imagePurposes)


    var shipAssetsToLoad = ["ships/" + this.meta.imageAssetsFile]
    var shipLoader = new PIXI.AssetLoader(shipAssetsToLoad)
    
    shipLoader.onComplete = _.bind(this.onAssetsLoaded, this)
    shipLoader.load()
}


ship.prototype.onAssetsLoaded = function() {
    // Get a list of the textures for the ship.
    this.textures = _.map(_.keys(this.shipImageInfo.frames),
			 function(frame) { return(PIXI.Texture.fromFrame(frame)) })

    this.sprite = new PIXI.Sprite(this.textures[0])
    this.sprite.anchor.x = 0.5
    this.sprite.anchor.y = 0.5
    this.turnRate = this.meta.physics.turn_rate * 2*Math.PI/120 // 10 nova ship turn rate/sec ~= 30°/sec This turn rate is radians/sec
    stage.addChild(this.sprite)
    this.renderReady = true
    requestAnimFrame( animate ) // make a system for this where multiple ships are happy.
    console.log("loaded assets for " + this.name) //should happen when ship is finished loading
    return true
}

/*
render(time, turning):
  if turning different from last_turning:
    turning_start_time = time
    turning_start_direction = direction
    omega = omega[turning]
  direction = (time - turning_start_time) * omega
  set_my_picture_to(direction)
*/
ship.prototype.updateStats = function(time, turning, accelerating) {

    ship.prototype.render.call(this, time, turning, accelerating) 
}
	
ship.prototype.render = function(time, turning, accelerating) {
    if (this.renderReady == true) {

	var frameStart = this.shipImageInfo.meta.imagePurposes.normal.start
	var frameCount = this.shipImageInfo.meta.imagePurposes.normal.length

	if (this.isPlayerShip == true) {
	    this.sprite.position.x = screenW/2 
	    this.sprite.position.y = screenH/2
	}	    

	if (turning == 'back') {
	    var vAngle = Math.acos((Math.pow(this.xvelocity, 2) - Math.pow(this.yvelocity, 2) - (Math.pow(this.xvelocity, 2) + Math.pow(this.yvelocity, 2)))/(-2*Math.pow(Math.pow(this.xvelocity, 2) + Math.pow(this.yvelocity, 2), 0.5) * this.yvelocity))
	    if (this.xvelocity < 0) {
		vAngle = vAngle * -1
	    }
	    console.log(vAngle)
	    var pointto = (vAngle + Math.PI) % (2*Math.PI)
	    var pointDiff = pointto - this.pointing
	    if (pointDiff < 0) {
		pointDiff += 2*Math.PI
	    }
	    if (pointDiff < Math.PI) {
		turning = "right"
	    }
	    else if(pointDiff > Math.PI) {
		turning = "left"
	    }
	    else {
		turning = "nowhere"
	    }
	}
	
	// if the new direction does not equal the previous direction
	if ((typeof this.lastTurning == 'undefined') || (turning != this.lastTurning)) { 
	    this.turnStartTime = time // the turn started at the average of the times
	    this.origionalPointing = this.pointing

	}
	if (turning == "left") {
	    this.pointing = this.origionalPointing - (this.turnRate * (time - this.turnStartTime) / 1000)
	    frameStart = this.shipImageInfo.meta.imagePurposes.left.start
	    frameCount = this.shipImageInfo.meta.imagePurposes.left.length
	}
	else if (turning == "right") {
	    this.pointing = this.origionalPointing + (this.turnRate * (time - this.turnStartTime) / 1000)
	    frameStart = this.shipImageInfo.meta.imagePurposes.right.start
	    frameCount = this.shipImageInfo.meta.imagePurposes.right.length
	}
	else if (turning == "back") { // turn backwards to velocity. Velocity not yet implemented.
	    //put some code here
	    console.log('turning = back')
	}
	else {
	    frameStart = this.shipImageInfo.meta.imagePurposes.normal.start
	    frameCount = this.shipImageInfo.meta.imagePurposes.normal.length
	}
	

	this.pointing = this.pointing % (2*Math.PI)  //makes sure ship.pointing is in the range [0, 2pi)
	if (this.pointing < 0) {
	    this.pointing += 2*Math.PI
	}
	
	
	// ship uses image 0 for [this.pointing - pi/frameCount, this.pointing + pi/frameCount) etc
	var useThisImage = Math.floor((this.pointing * frameCount/(2*Math.PI) + .5) % frameCount) + frameStart

	this.sprite.rotation = (this.pointing + (Math.PI / frameCount)) % (2*Math.PI/frameCount) - Math.PI/frameCount // how much to rotate the image

	this.sprite.setTexture(this.textures[useThisImage])


	// this.origionalPointing is the angle the ship was pointed towards before it was told a different direction to turn.
	this.lastTurning = turning // last turning value: left, right, or back

	//acceleration
	var xaccel = Math.sin(this.pointing) * this.meta.physics.acceleration
	var yaccel = Math.cos(this.pointing) * this.meta.physics.acceleration
	if (accelerating == true) {
	    if (typeof this.previousAccelTime != 'undefined') {
		this.xvelocity += xaccel * (time - this.previousAccelTime)/1000
		this.yvelocity += yaccel * (time - this.previousAccelTime)/1000
	    }

	    this.previousAccelTime = time
	}

	return true
    }
    else {
	return false // oh no. I'm not ready to render. better not try
    }
}

function playerShip(shipName) {
    this.pointing = Math.random()*2*Math.PI
    ship.call(this, shipName)
    this.xvelocity = 0
    this.yvelocity = 0
    this.isPlayerShip = true
}

playerShip.prototype = new ship

playerShip.prototype.onAssetsLoaded = function() {
    if (ship.prototype.onAssetsLoaded.call(this)) {
	console.log("and it's mine")


    }
}




var myShip = new playerShip("Starbridge A")
myShip.build()




function animate() {
    requestAnimFrame( animate )
    time = new Date().getTime()
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
	turning = 'back'
    }
    if (_.contains(keys, 'up')) {
	accelerating = true
    }
    else {
	accelerating = false
    }
    myShip.updateStats(time, turning, accelerating)
    renderer.render(stage)
}
/*
var ship;
var shipTextures;
var shipTexture = 1;

var myShip = new playerShip("mother")
myShip.build()

var starbridgeAssetsToLoader = ["ships/Starbridge.json"];
starbridgeLoader = new PIXI.AssetLoader(starbridgeAssetsToLoader);
starbridgeLoader.onComplete = onAssetsLoaded;
starbridgeLoader.load();

function onAssetsLoaded() {


    shipTextures = [];
    for (var i=0; i<108; i++) {

	var texture = PIXI.Texture.fromFrame("Starbridge " + (i+1) + ".png");
	shipTextures.push(texture);


    };
    // create a texture from an image path
    //var test = PIXI.Texture.fromImage("ships/Starbridge.png");
    // create a new Sprite using the texture
    ship = new PIXI.Sprite(shipTextures[0]);

    //ship.setTexture(shipTextures[0]);
    // center the sprites anchor point
    ship.anchor.x = 0.5;
    ship.anchor.y = 0.5;
    ship.pointing = Math.random() * 2 * Math.PI
    ship.turnRate = 0.1

    // move the sprite t the center of the screen
    ship.position.x = screenW/2;
    ship.position.y = screenH/2;
    stage.addChild(ship);    
    requestAnimFrame( animate );

}

function animate() {

    requestAnimFrame( animate );

    // just for fun, lets rotate mr rabbit a little
    //ship.rotation += 0.1;
    //ship.turnRate = 0.01
    var keys = KeyboardJS.activeKeys()
    ship.banking = 0
    if (_.contains(keys, 'right')) {
	ship.pointing += ship.turnRate
	ship.banking = 72
    }
    if (_.contains(keys, 'left')) {
	ship.pointing = ship.pointing - ship.turnRate
	ship.banking = 36
    }
    if (_.contains(keys, 'left') && _.contains(keys, 'right')) {
	ship.banking = 0
    }



    if (ship.pointing >= 2*Math.PI) {
	ship.pointing = 0
    }
    if (ship.pointing < 0) {
	ship.pointing += 2*Math.PI
    }

    var shipRange = ship.pointing * 36 / (2*Math.PI)
    shipTexture = Math.floor(shipRange) + ship.banking

    ship.rotation = ((shipRange % 1 - 0.5) * Math.PI / 18)


    ship.setTexture(shipTextures[shipTexture])


    //if (shipTexture < 35) {
	//shipTexture++
   // }
    //else {
	//shipTexture = 1
    //}

    ship.position.x = screenW/2;
    ship.position.y = screenH/2;
    // render the stage   
    renderer.render(stage);
}
*/

function onResize() {
    screenW = $(window).width();
    screenH = $(window).height();
    renderer.resize(screenW,screenH);
}


