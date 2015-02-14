function object(objectName) {
    this.name = objectName || ""
    this.renderReady = false
    this.lastAccelerating = false
    this.url = 'objects/'
}

object.prototype.build = function() {
    //console.log(this.name)
    var url = this.url + this.name + '.json'
    var loader = new PIXI.JsonLoader(url);
    loader.on('loaded', _.bind(this.interpretObjectJsonAndStartInterpretObjectImageJson, this))
    loader.load()
}

object.prototype.interpretObjectJsonAndStartInterpretObjectImageJson = function(evt) {
    //data is in evt.content.json
    this.meta = evt.content.json //generic object infromation. Not Graphics.
    console.log(this.meta)	// DEBUG
    
    var url = this.url + this.meta.imageAssetsFile
    var loader = new PIXI.JsonLoader(url)
    console.log('loading' + this.url + this.meta.imageAssetsFile) //DEBUG

    loader.on('loaded', _.bind(this.interpretObjectImageJson, this))
    loader.load()
}

object.prototype.interpretObjectImageJson = function(evt) {
    this.objectImageInfo = evt.content.json
    console.log(this.objectImageInfo.meta.imagePurposes)


    var objectAssetsToLoad = [this.url + this.meta.imageAssetsFile]
    var objectLoader = new PIXI.AssetLoader(objectAssetsToLoad)
    
    objectLoader.onComplete = _.bind(this.onAssetsLoaded, this)
    objectLoader.load()
}

object.prototype.onAssetsLoaded = function() {
    // Get a list of the textures for the object.
    this.textures = _.map(_.keys(this.objectImageInfo.frames),
			 function(frame) { return(PIXI.Texture.fromFrame(frame)) })

    this.sprite = new PIXI.Sprite(this.textures[0])
    this.sprite.anchor.x = 0.5
    this.sprite.anchor.y = 0.5
    this.turnRate = this.meta.physics.turn_rate * 2*Math.PI/120 // 10 nova object turn rate/sec ~= 30°/sec This turn rate is radians/sec
    stage.addChild(this.sprite)
    this.renderReady = true
//    requestAnimFrame( animate ) // make a system for this where multiple objects are happy.
    console.log("loaded assets for " + this.name) //should happen when object is finished loading
    return true
}

object.prototype.updateStats = function(turning) {

    object.prototype.render.call(this, turning) 
}



/*
  The object render function handles the turning and rendering of space objects. TODO: instead of having this handle one pixi object, make it handle the ship, the running lights, and the thrusters. It can have a list to store the pixi objects in and iterate over that list? 

*/
object.prototype.render = function(turning) {
    if (this.renderReady == true) {
	
	var frameStart = this.objectImageInfo.meta.imagePurposes.normal.start
	var frameCount = this.objectImageInfo.meta.imagePurposes.normal.length
	if (this.isPlayerShip == true) {
	    this.sprite.position.x = screenW/2 
	    this.sprite.position.y = screenH/2
	}	    

	
	// if the new direction does not equal the previous direction
	if ((typeof this.lastTurning == 'undefined') || (turning != this.lastTurning) || this.turnback != this.lastTurnBack) { 
	    this.turnStartTime = this.time // the turn started at the average of the times
	    this.origionalPointing = this.pointing
	    this.lastTurnBack = this.turnback

	}
	if (turning == "left") {
	    this.pointing = this.origionalPointing + (this.turnRate * (this.time - this.turnStartTime) / 1000)
	    frameStart = this.objectImageInfo.meta.imagePurposes.left.start
	    frameCount = this.objectImageInfo.meta.imagePurposes.left.length   

	}
	else if (turning == "right") {
	    this.pointing = this.origionalPointing - (this.turnRate * (this.time - this.turnStartTime) / 1000)
	    frameStart = this.objectImageInfo.meta.imagePurposes.right.start
	    frameCount = this.objectImageInfo.meta.imagePurposes.right.length
	}

	else {
	    frameStart = this.objectImageInfo.meta.imagePurposes.normal.start
	    frameCount = this.objectImageInfo.meta.imagePurposes.normal.length
	}

	this.lastTime = this.time
	this.pointing = this.pointing % (2*Math.PI)  //makes sure object.pointing is in the range [0, 2pi)
	if (this.pointing < 0) {
	    this.pointing += 2*Math.PI
	}
	
	
	// object uses image 0 for [this.pointing - pi/frameCount, this.pointing + pi/frameCount) etc

	var useThisImage = Math.floor((2.5*Math.PI - this.pointing)%(2*Math.PI) * frameCount / (2*Math.PI)) + frameStart
	//console.log(useThisImage)
	this.sprite.rotation = (-1*this.pointing) % (2*Math.PI/frameCount) + (Math.PI/frameCount)  // how much to rotate the image

	this.sprite.setTexture(this.textures[useThisImage])


	// this.origionalPointing is the angle the object was pointed towards before it was told a different direction to turn.
	this.lastTurning = turning // last turning value: left, right, or back


	return true
    }
    else {
	return false // oh no. I'm not ready to render. better not try
    }
}

