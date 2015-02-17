function object(objectName) {
    this.name = objectName || ""
    this.renderReady = false
    this.lastAccelerating = false
    this.url = 'objects/'
    this.position = [0,0]
}

object.prototype.build = function() {
    var jsonUrl = this.url + this.name + '.json'
    var loader = new PIXI.JsonLoader(jsonUrl);
    loader.on('loaded', _.bind(this.makeSprites, this))
    loader.load()
}

object.prototype.makeSprites = function(evt) {
    console.log("making sprites")
    this.meta = evt.content.json 
    this.turnRate = this.meta.physics.turn_rate * 2*Math.PI/120 // 10 nova object turn rate/sec ~= 30°/sec This turn rate is radians/sec
    console.log(this.meta)
    this.sprites = {};
    this.spriteContainer = new PIXI.DisplayObjectContainer()

    _.each(_.keys(this.meta.imageAssetsFiles), function(key) {
	if (this.meta.imageAssetsFiles.hasOwnProperty(key)) {
	    this.sprites[key] = new sprite(this.url + this.meta.imageAssetsFiles[key])
	}
    }, this);
    this.loadedSprites = 0;
    
    var scope = this
    
    var spriteLoadedCallback = function(scope) {
	return function() {
	    scope.loadedSprites ++;
//	    console.log(this)
	    if (scope.loadedSprites == _.keys(scope.sprites).length) {
		scope.renderReady = true
		scope.addSpritesToContainer()
	    }
	}
    }

    _.each(_.values(this.sprites), function(s) {s.build(spriteLoadedCallback(scope))} );

}

//write this method in the ships funcitons to add engines and lights in the right order
object.prototype.addSpritesToContainer = function() {

    _.each(_.map(_.values(this.sprites), function(s) {return s.sprite}), function(s) {this.spriteContainer.addChild(s)}, this);
    stage.addChild(this.spriteContainer)


}

object.prototype.updateStats = function(turning) {

    object.prototype.render.call(this, turning) 
}

object.prototype.callSprites = function(toCall) {
    _.each(_.map(_.values(this.sprites), function(x) {return x.sprite}), toCall, this)
}

/*
  The object render function handles the turning and rendering of space objects. TODO: instead of having this handle one pixi object, make it handle the ship, the running lights, and the thrusters. It can have a list to store the pixi objects in and iterate over that list? 

*/
object.prototype.render = function(turning) {
    if (this.renderReady == true) {
	var frameStart = _.map(this.sprites, function(s) {return s.spriteImageInfo.meta.imagePurposes.normal.start})
	var frameCount = _.map(this.sprites, function(s) {return s.spriteImageInfo.meta.imagePurposes.normal.length})
	//this.callSprites(function(a,b,c) {console.log(a)})

	//var frameStart = this.objectImageInfo.meta.imagePurposes.normal.start
	//var frameCount = this.objectImageInfo.meta.imagePurposes.normal.length
	if (this.isPlayerShip == true) {
	    //this.callSprites(function(s,b,c) {s.position.x = screenW/2})
	    //this.callSprites(function(s,b,c) {s.position.y = screenH/2})
	    this.spriteContainer.position.x = screenW/2 
	    this.spriteContainer.position.y = screenH/2
	}
	else {
	    //this.callSprites(function(s,b,c) {s.position.x = positionConstant * (this.position[0] - stagePosition[0]) + screenW/2})
	    //this.callSprites(function(s,b,c) {s.position.y = -1 * positionConstant * (this.position[1] - stagePosition[1]) + screenH/2})
	    this.spriteContainer.position.x = positionConstant * (this.position[0] - stagePosition[0]) + screenW/2
	    this.spriteContainer.position.y = -1 * positionConstant * (this.position[1] - stagePosition[1]) + screenH/2
	}
	
	// if the new direction does not equal the previous direction
	if ((typeof this.lastTurning == 'undefined') || (turning != this.lastTurning) || this.turnback != this.lastTurnBack) { 
	    this.turnStartTime = this.time // the turn started at the average of the times
	    this.origionalPointing = this.pointing
	    this.lastTurnBack = this.turnback

	}
	if (turning == "left") {
	    this.pointing = this.origionalPointing + (this.turnRate * (this.time - this.turnStartTime) / 1000)
	    frameStart = _.map(this.sprites, function(s){ return s.spriteImageInfo.meta.imagePurposes.left.start })
	    frameCount = _.map(this.sprites, function(s){ return s.spriteImageInfo.meta.imagePurposes.left.length })
	}
	else if (turning == "right") {
	    this.pointing = this.origionalPointing - (this.turnRate * (this.time - this.turnStartTime) / 1000)

	    frameStart = _.map(this.sprites, function(s){ return s.spriteImageInfo.meta.imagePurposes.right.start })
	    frameCount = _.map(this.sprites, function(s){ return s.spriteImageInfo.meta.imagePurposes.right.length })
	}

	else {
	    frameStart = _.map(this.sprites, function(s){ return s.spriteImageInfo.meta.imagePurposes.normal.start })
	    frameCount = _.map(this.sprites, function(s){ return s.spriteImageInfo.meta.imagePurposes.normal.length })
	}


	this.pointing = this.pointing % (2*Math.PI)  //makes sure object.pointing is in the range [0, 2pi)
	if (this.pointing < 0) {
	    this.pointing += 2*Math.PI
	}

	var useThisImage = []
	for (var i = 0; i < _.keys(this.sprites).length; i++) {
	    // object uses image 0 for [this.pointing - pi/frameCount, this.pointing + pi/frameCount) etc
	    var spr = _.values(this.sprites)
	    useThisImage[i] = Math.floor((2.5*Math.PI - this.pointing)%(2*Math.PI) * frameCount[i] / (2*Math.PI)) + frameStart[i]
	    //console.log(useThisImage)
	    spr[i].sprite.rotation = (-1*this.pointing) % (2*Math.PI/frameCount[i]) + (Math.PI/frameCount[i])  // how much to rotate the image

	    spr[i].sprite.setTexture(spr[i].textures[useThisImage[i]])
	}

	// this.origionalPointing is the angle the object was pointed towards before it was told a different direction to turn.
	this.lastTurning = turning // last turning value: left, right, or back

	this.lastTime = this.time
	return true
    }
    else {
	return false // oh no. I'm not ready to render. better not try
    }
}

