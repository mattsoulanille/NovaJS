if (typeof(module) !== 'undefined') {
    module.exports = ship;
    var acceleratable = require("../server/acceleratableServer.js");
    var _ = require("underscore");
    var Promise = require("bluebird");
    var outfit = require("../server/outfitServer.js");

}


function ship(buildInfo, system) {
    acceleratable.call(this, buildInfo, system);
    this.url = 'objects/ships/';
    this.pointing = 0;
    this.weapons = {};
    this.weapons.all = [];
    this.outfits = [];
    this.target = undefined;
    this.turningToTarget = false;
    if (typeof(buildInfo) !== 'undefined') {
	this.outfitList = buildInfo.outfits || [];
	this.buildInfo.type = "ship";
    }
    if (typeof system !== 'undefined') {
	system.ships.push(this);
    }

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
	    
	    this.fuel = this.properties.maxFuel;

	    this.system.built.ships.push(this)
	}, this))



    // return RSVP.all(outfitPromises)
    // 	.then(acceleratable.prototype.build.call(this))
    // 	.catch(function(reason) {console.log(reason)});


}
ship.prototype.buildTargetImage = function() {
    this.targetImage = new targetImage(this.meta.targetImage);
    return this.targetImage.build()
}

ship.prototype.buildOutfits = function() {
    // builds outfits to this.outfits from this.outfitList

    _.each(this.outfitList, function(buildInfo) {

	var o = new outfit(buildInfo);
	this.outfits.push(o);
    }.bind(this));
    
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

ship.prototype.updateStats = function(stats) {
    acceleratable.prototype.updateStats.call(this, stats);
    if (this.isPlayerShip !== true) {
	if (typeof stats.target !== 'undefined') {
	    this.cycleTarget(this.system.multiplayer[stats.target]);
	}
	else {
	    this.cycleTarget(undefined);
	}
    }
    if (typeof stats.turningToTarget !== 'undefined') {
	this.turningToTarget = stats.turningToTarget;
    }
}

ship.prototype.getStats = function(stats) {
    var stats = acceleratable.prototype.getStats.call(this);
    if (typeof this.target !== 'undefined') {
	stats.target = this.target.UUID;
    }
    else {
	stats.target = undefined;
    }
    stats.turningToTarget = this.turningToTarget;
    return stats;
}


ship.prototype.turnToTarget = function() {
    if (typeof this.target !== 'undefined') {
	var x = this.target.position[0] - this.position[0];
	var y = this.target.position[1] - this.position[1];
	var direction = (Math.atan2(y,x) + 2*Math.PI) % (2*Math.PI);

	this.turnTo(direction);
    }
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
    if ("engine" in this.sprites) {
	if (this.accelerating == 1) {
	    this.sprites.engine.sprite.alpha = 1;
	}
	else {
	    this.sprites.engine.sprite.alpha = 0;
	}
    }

    if ("lights" in this.sprites) {
	this.manageLights();
    }

    if (this.turningToTarget) {
	this.turnToTarget();
    }

    
    if (this.properties.fuelRecharge) {
	// Fuel recharge is in frames / unit, so recharge ^ -1 = units / frame
	// 30 nova frames / second
	// 30 frames/sec * x units / frame = x units / sec
	this.fuel += (30 / this.properties.fuelRecharge) * (this.time - this.lastTime) / 1000;
    }
    if (this.fuel > this.properties.maxFuel) {
	this.fuel = this.properties.maxFuel;
    }
    
    acceleratable.prototype.render.call(this);
}
ship.prototype.cycleTarget = function(newTarget) {

    this.target = newTarget;
    _.each(this.weapons.all, function(w) {w.cycleTarget(this.target)}, this);
    

}

ship.prototype.show = function() {
    this.targetable = true;
    acceleratable.prototype.show.call(this);
}

ship.prototype.hide = function() {
    this.targetable = false;
    acceleratable.prototype.hide.call(this);
}


ship.prototype.destroy = function() {
    
    var index = this.system.ships.indexOf(this);
    if (index !== -1) {
	this.system.ships.splice(index, 1);
    }

    if (this.built) {
	index = this.system.built.ships.indexOf(this);
	if (index !== -1) {
	    this.system.built.ships.splice(index, 1);
	}
    }

    _.each(this.outfits, function(o) {o.destroy()});
    acceleratable.prototype.destroy.call(this);
}
