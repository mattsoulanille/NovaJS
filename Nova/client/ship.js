if (typeof(module) !== 'undefined') {
    var acceleratable = require("../server/acceleratableServer.js");
    var turnable = require("../server/turnableServer.js");
    var damageable = require("../server/damageableServer.js");
    var collidable = require("../server/collidableServer.js");
    var movable = require("../server/movableServer.js");
    var spaceObject = require("../server/spaceObjectServer.js");
    var _ = require("underscore");
    var Promise = require("bluebird");
    var outfit = require("../server/outfitServer.js");
}

ship = class extends acceleratable(turnable(damageable(collidable(movable(spaceObject))))) {
    //temporary. Will make it work with inertialess also
    constructor(buildInfo, system) {
	super(buildInfo, system);
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

    }

    build() {
	return super.build.call(this)
	//	.then(function() {console.log(this)}.bind(this))
	    .then(function() {this.built = false}.bind(this))
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
		if (this.system) {
		    this.system.built.ships.add(this);
		}
		this.built = true;
		
	    }, this))
	
    }


    buildTargetImage() {
	this.targetImage = new targetImage(this.meta.targetImage);
	return this.targetImage.build()
    }

    buildOutfits() {
	// builds outfits to this.outfits from this.outfitList
	
	_.each(this.outfitList, function(buildInfo) {
	    
	    var o = new outfit(buildInfo);
	    this.outfits.push(o);
	    this.addChild(o);
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

	return Promise.all(outfitPromises);
    }

    addSpritesToContainer() {

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
	_.each(without, function(x) {this.container.addChild(x)}, this);
	_.each(orderedSprites, function(x) {this.container.addChild(x)}, this);
	this.system.container.addChild(this.container);
    }

    updateStats(stats) {
	super.updateStats.call(this, stats);
	if (this.isPlayerShip !== true) {
	    if (typeof stats.target !== 'undefined') {
		this.setTarget(this.system.multiplayer[stats.target]);
	    }
	    else {
		this.setTarget(undefined);
	    }
	}
	if (typeof stats.turningToTarget !== 'undefined') {
	    this.turningToTarget = stats.turningToTarget;
	}
    }

    getStats(stats) {
	var stats = super.getStats.call(this);
	if (typeof this.target !== 'undefined') {
	    stats.target = this.target.UUID;
	}
	else {
	    stats.target = undefined;
	}
	stats.turningToTarget = this.turningToTarget;
	return stats;
    }


    turnToTarget() {
	if (typeof this.target !== 'undefined') {
	    var x = this.target.position[0] - this.position[0];
	    var y = this.target.position[1] - this.position[1];
	    var direction = (Math.atan2(y,x) + 2*Math.PI) % (2*Math.PI);
	    
	    this.turnTo(direction);
	}
    }





    manageLights() {
    
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

    manageEngine() {
	if (this.accelerating == 1) {
	    this.sprites.engine.sprite.alpha = 1;
	}
	else {
	    this.sprites.engine.sprite.alpha = 0;
	}
    }
    
    render() {
	// maybe revise this to be a set of functions that are all called when rendering
	// so you don't have to do 'if' every time you render
	if ("engine" in this.sprites) {
	    this.manageEngine();
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
	
	super.render.call(this);
	// super hacky bounding box
	var bound = [5000,5000];
	if (this.position[0] > bound[0]/2) {
	    this.position[0] -= bound[0];
	}
	if (this.position[0] < -bound[0]/2) {
	    this.position[0] += bound[0];
	}
	if (this.position[1] > bound[1]/2) {
	    this.position[1] -= bound[1];
	}
	if (this.position[1] < -bound[1]/2) {
	    this.position[1] += bound[1];
	}

    }
    setTarget(newTarget) {
	
	this.target = newTarget;
	_.each(this.weapons.all, function(w) {w.setTarget(this.target)}, this);
	
    }

    show() {
	this.targetable = true;
	super.show.call(this);
    }

    hide() {
	this.targetable = false;
	super.hide.call(this);
    }

    _addToSystem() {
        if (this.built) {
            this.system.built.ships.add(this);
        }
        this.system.ships.add(this);

        super._addToSystem.call(this);
    }

    _removeFromSystem() {
        if (this.built) {
            this.system.built.ships.delete(this);
        }
        this.system.ships.delete(this);

        super._removeFromSystem.call(this);
    }

    
    destroy() {
	
	_.each(this.outfits, function(o) {o.destroy()});
	super.destroy.call(this);
    }
}





if (typeof(module) !== 'undefined') {
    module.exports = ship;
}

