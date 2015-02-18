function ship(shipName) {
    movable.call(this, shipName)
    this.url = 'objects/ships/'
    this.pointing = 0

}
ship.prototype = new movable


ship.prototype.addSpritesToContainer = function() {

    var orderedSprites = [this.sprites.ship.sprite]
    if ("lights" in this.sprites) {
	orderedSprites.push(this.sprites.lights.sprite)
    }
     
    if ("engine" in this.sprites) {
	orderedSprites.push(this.sprites.engine.sprite)
    }


    var spriteList = _.map(_.values(this.sprites), function(s) {return s.sprite})
    var without =  _.difference(spriteList, orderedSprites)
    console.log(without)
    _.each(without, function(x) {this.spriteContainer.addChild(x)}, this);
    _.each(orderedSprites, function(x) {this.spriteContainer.addChild(x)}, this);
    stage.addChild(this.spriteContainer)
}

ship.prototype.updateStats = function(turning, accelerating) {
    if (accelerating) {
	this.sprites.engine.sprite.alpha = 1
    }
    else {
	this.sprites.engine.sprite.alpha = 0
    }

    if ("lights" in this.sprites) {
	this.manageLights()
    }

    movable.prototype.updateStats.call(this, turning, accelerating)
}

ship.prototype.manageLights = function() {
    
    if (typeof this.manageLights.state == 'undefined' || typeof this.manageLights.lastSwitch == 'undefined') {
	this.manageLights.state = true
	this.manageLights.lastSwitch = this.time
    }
    else {
	if (this.time - this.manageLights.lastSwitch > 1000) {
	    this.manageLights.state = !this.manageLights.state
	    this.manageLights.lastSwitch = this.time
	}
    }
    if (this.manageLights.state) {
	this.sprites.lights.sprite.alpha = 1
    }
    else {
	this.sprites.lights.sprite.alpha = 0
    }

}
