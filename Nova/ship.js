function ship(shipName, outfits) {
    movable.call(this, shipName)
    this.url = 'objects/ships/'
    this.pointing = 0;
    this.outfits = outfits || [];
}
ship.prototype = new movable


ship.prototype.build = function() {

    var outfitPromises = _.map(this.outfits, function(outfit) {
	//build unbuild outfits
	if (outfit.ready) {
	    return new RSVP.Promise(function(fulfill, reject){fulfill()})
	}
	else {
	    return outfit.build(this);
	}
	//console.log(this);
	
    }.bind(this));

    return RSVP.all(outfitPromises)
	.then(movable.prototype.build.call(this))
	.catch(function(reason) {console.log(reason)});


}



ship.prototype.addSpritesToContainer = function() {

    // adds sprites to the container in the correct order to have proper
    // layering of engine, ship, lights etc.
    var orderedSprites = [this.sprites.ship.sprite]
    if ("lights" in this.sprites) {
	orderedSprites.push(this.sprites.lights.sprite)
    }
     
    if ("engine" in this.sprites) {
	orderedSprites.push(this.sprites.engine.sprite)
    }


    var spriteList = _.map(_.values(this.sprites), function(s) {return s.sprite;})

    //sprites that have no specified order
    var without =  _.difference(spriteList, orderedSprites) 
    //console.log(without)
    _.each(without, function(x) {this.spriteContainer.addChild(x)}, this);
    _.each(orderedSprites, function(x) {this.spriteContainer.addChild(x)}, this);
    stage.addChild(this.spriteContainer)
}

ship.prototype.updateStats = function(turning, accelerating) {

    movable.prototype.updateStats.call(this, turning, accelerating);
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

ship.prototype.render = function() {
    if (this.accelerating) {
	this.sprites.engine.sprite.alpha = 1;
    }
    else {
	this.sprites.engine.sprite.alpha = 0;
    }

    if ("lights" in this.sprites) {
	this.manageLights();
    }
    movable.prototype.render.call(this);
}
