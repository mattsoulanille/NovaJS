function ship(shipName, outfits) {
    movable.call(this, shipName)
    this.url = 'objects/ships/'
    this.pointing = 0;
    this.outfits = outfits || [];
}
ship.prototype = new acceleratable;



ship.prototype.build = function() {



    return acceleratable.prototype.build.call(this)
//	.then(function() {console.log(this)}.bind(this))
	.then(_.bind(this.buildOutfits, this))
	.then(_.bind(this.buildTargetImage, this))
	.then(_.bind(function() {
	    // make sure ship properties are sane after loading outfits
	    if (this.properties.maxSpeed < 0) {
		this.properties.maxSpeed = 0
	    }
	    if (this.properties.turnRate < 0) {
		this.properties.turnRate = 0
	    }
	    
	}, this))
    	.catch(function(reason) {console.log(reason)});

    // return RSVP.all(outfitPromises)
    // 	.then(acceleratable.prototype.build.call(this))
    // 	.catch(function(reason) {console.log(reason)});


}

ship.prototype.buildTargetImage = function() {
    this.targetImage = new targetImage(this.meta.targetImage);
    return this.targetImage.build()
}

ship.prototype.buildOutfits = function() {
    // builds outfits in this.outfits
    var outfitPromises = _.map(this.outfits, function(anOutfit) {
	//build unbuild outfits
	if (anOutfit.ready) {
	    return new Promise(function(fulfill, reject){fulfill()})
	}
	else {
	    return anOutfit.build(this);
	}
	//console.log(this);
	
    }.bind(this));

    return Promise.all(outfitPromises)
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

    acceleratable.prototype.updateStats.call(this, turning, accelerating);
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
    acceleratable.prototype.render.call(this);
}
