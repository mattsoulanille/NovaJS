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
    var weaponBuilder = require("../server/weaponBuilderServer.js");
    var exitPoint = require("./exitPoint.js");
    var errors = require("../client/errors.js");
    var UnsupportedWeaponTypeError = errors.UnsupportedWeaponTypeError;

}

ship = class extends acceleratable(turnable(damageable(collidable(movable(spaceObject))))) {
    constructor(buildInfo, system) {
	super(...arguments);
	//this.url = 'objects/ships/';
	this.type = 'ships';
	this.pointing = 0;
	this.weapons = {};
	this.weapons.all = [];
	this.outfits = [];
	
	this.turningToTarget = false;
	this.landedOn = null;
	if (typeof(buildInfo) !== 'undefined') {
	    //this.outfitList = buildInfo.outfits || [];
	    this.buildInfo.type = "ship";
	}

    }

    _bindListeners() {
	this.multiplayer.on("setOutfits", this._setOutfitsListener.bind(this));
    }
    
    async _build() {
	await super._build();
	this.buildTargetImage();

	this.buildExitPoints();
	await this.buildOutfits();
	await this.buildExplosion();

	this.energy = this.properties.energy;
	if (this.system) {
	    this.system.built.ships.add(this);
	}
	this._bindListeners();
    }


    buildExitPoints() {
	for (var name in this.meta.animation.exitPoints) {
	    if (name === 'upCompress' || name === 'downCompress') {
		// probably revise how exitPoints are stored in meta
		continue;
	    }

	    this.exitPoints[name] = this.meta.animation.exitPoints[name].map(function(offset) {
		return new exitPoint(this, offset,
				     this.meta.animation.exitPoints.upCompress,
				     this.meta.animation.exitPoints.downCompress);
	    }.bind(this));


	}
    }

    
    buildTargetImage() {
	var textureToUse = Math.round(this.meta.animation.images.baseImage.imagePurposes.normal.length
				      * 2/3);

	// Is scaled so must be sprite.
	this.targetImage = new PIXI.Sprite(this.sprites.baseImage.textures[textureToUse]);
	this.targetImage.anchor.x = 0.5;
	this.targetImage.anchor.y = 0.5;
	var frame = this.targetImage.texture.frame;
	var longest = Math.max(frame.height, frame.width);
	if (longest > 90) {
	    var scale = 90 / longest;
	}
	else {
	    scale = 1;
	}
	this.targetImage.scale.x = scale;
	this.targetImage.scale.y = scale;
    }

    async buildExplosion() {
	if (this.properties.initialExplosion) {
	    this.initialExplosion = new explosion(this.properties.initialExplosion);
	    await this.initialExplosion.build();
	    this.addChild(this.initialExplosion);
	}
	
	if (this.properties.finalExplosion) {
	    this.finalExplosion = new explosion(this.properties.finalExplosion);
	    await this.finalExplosion.build();
	    this.addChild(this.finalExplosion);
	}
	
	
    }
    
    get UUIDS() {
	var uuids = super.UUIDS;
	this.weapons.all.forEach(function(weap) {
	    uuids.push(weap.UUID);
	});
	return uuids;
    }

    
    buildDefaultWeapons() {
	// builds the default weapons that come with the ship
	// temporary, but could be useful to adapt for outfit.js
	// see shipServer.js for how it gets UUIDS
	
	var promises = this.buildInfo.weapons.map(this.buildWeapon.bind(this));

	return Promise.all(promises);

    }

    _setOutfitsListener(outfits) {
	//this.destroyOutfits();
	this.properties.outfits = outfits;
	this.buildInfo.outfits = outfits;
	this.buildOutfits(outfits);
    }
    
    async buildOutfits(outfits) {
	// Gets outfits from the server and builds them
	// Or builds outfits given

	this.setProperties(); // reset the ship properties since they're changed by outfits
	this.weapons.all.forEach(function(w) {w.destroy();});
	this.outfits.forEach(function(o) {o.destroy();});
	this.weapons.all = [];

	if (typeof outfits == "undefined" ) {
	    this.properties.outfits = await this.getOutfits();
	}
	else {
	    this.properties.outfits = outfits;
	}
	
	this.outfits = this.properties.outfits.map(function(buildInfo) {
	    var o = new outfit(buildInfo, this);
	    this.addChild(o);
	    return o;
	}.bind(this));
	
	var outfitPromises = this.outfits.map(function(anOutfit) {
	    return anOutfit.build();
	});

	await Promise.all(outfitPromises);

	this.outfits.forEach(function(o) {
	    if (o.weapon) {
		this.weapons.all.push(o.weapon);
	    }
	}.bind(this));

	// make sure ship properties are sane after loading outfits
	if (this.properties.maxSpeed < 0) {
	    this.properties.maxSpeed = 0;
	}
	if (this.properties.turnRate < 0) {
	    this.properties.turnRate = 0;
	}
    }



    setProperties() {
	super.setProperties();
	this.properties.vulnerableTo = ["normal"];
    }

    getOutfits() {
	return this.multiplayer.query("getOutfits"); // a promise
    }

    
    
    
    
    addSpritesToContainer() {

	// adds sprites to the container in the correct order to have proper
	// layering of engine, ship, lights etc.
	// Also set the correct blend mode
	var orderedSprites = [this.sprites.baseImage.sprite];
	if ("lightImage" in this.sprites) {
	    orderedSprites.push(this.sprites.lightImage.sprite);
	    this.sprites.lightImage.sprite.blendMode = PIXI.BLEND_MODES["ADD"];
	}
	
	if ("glowImage" in this.sprites) {
	    orderedSprites.push(this.sprites.glowImage.sprite);
	    this.sprites.glowImage.sprite.blendMode = PIXI.BLEND_MODES["ADD"];
	}

	if ("weapImage" in this.sprites) {
	    orderedSprites.push(this.sprites.weapImage.sprite);
	    this.sprites.weapImage.sprite.blendMode = PIXI.BLEND_MODES["ADD"];
	}
	
	
	var spriteList = _.map(_.values(this.sprites), function(s) {return s.sprite;});
	
	//sprites that have no specified order
	var without =  _.difference(spriteList, orderedSprites);
	//console.log(without)
	_.each(without, function(x) {this.container.addChild(x);}, this);
	_.each(orderedSprites, function(x) {this.container.addChild(x);}, this);
	//this.system.container.addChild(this.container);
    }

    updateStats(stats) {
	//console.log("updated ship stats");
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

    getStats() {
	var stats = super.getStats.call(this);
	if (this.target) {
	    stats.target = this.target.UUID;
	}
	else {
	    stats.target = null;
	}
	stats.turningToTarget = this.turningToTarget;
	return stats;
    }


    turnToTarget() {
	if (this.target) {
	    var x = this.target.position[0] - this.position[0];
	    var y = this.target.position[1] - this.position[1];
	    var direction = (Math.atan2(y,x) + 2*Math.PI) % (2*Math.PI);
	    
	    this.turnTo(direction);
	}
    }

    blinkFiringAnimation(ms = 16) {
	if ("weapImage" in this.sprites) {
	    var hideAfter = !this.sprites.weapImage.sprite.visible;
	    this.sprites.weapImage.sprite.visible = true;
	    setTimeout(function() {
		if (hideAfter) {
		    this.sprites.weapImage.sprite.visible = false;
		}
	    }.bind(this), ms);
	}
    }

    manageFireImage() {
	var show = false;
	for (let prop in this.weapons.all) {
	    let weap = this.weapons.all[prop];
	    if (weap.firing && weap.meta.useFiringAnimation) {
		show = true;
		break;
	    }
	}
	this.sprites.weapImage.sprite.visible = show;
    }

    manageLights() {
    
	if (typeof this.manageLights.state == 'undefined' || typeof this.manageLights.lastSwitch == 'undefined') {
	    this.manageLights.state = true;
	    this.manageLights.lastSwitch = this.time;
	}
	else {
	    if (this.time - this.manageLights.lastSwitch > 1000) {
		this.manageLights.state = !this.manageLights.state;
		this.manageLights.lastSwitch = this.time;
	    }
	}
	if (this.manageLights.state) {
	    this.sprites.lightImage.sprite.alpha = 1;
	}
	else {
	    this.sprites.lightImage.sprite.alpha = 0;
	}
	
    }

    manageEngine() {
	if (this.accelerating == 1) {
	    this.sprites.glowImage.sprite.alpha = 1;
	}
	else {
	    this.sprites.glowImage.sprite.alpha = 0;
	}
    }
    
    render() {
	// maybe revise this to be a set of functions that are all called when rendering
	// so you don't have to do 'if' every time you render
	if ("glowImage" in this.sprites) {
	    this.manageEngine();
	}
	
	if ("lightImage" in this.sprites) {
	    this.manageLights();
	}

	if ("weapImage" in this.sprites) {
	    this.manageFireImage();
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
	
	super.render(...arguments);
	// super hacky bounding box
	var bound = [7000,7000];
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
	super.setTarget(newTarget);
	_.each(this.weapons.all, function(w) {w.setTarget(this.target)}, this);
	
    }

    setVisible(v) {
	if (v) {
	    this.system.targetable.add(this);	    
	}
	else {
	    this.system.targetable.delete(this);
	}
	super.setVisible(v);
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

    _smallExplosion() {
	var pos = [...this.position];
	pos[0] += Math.random() * this.size[0] - this.size[0] / 2;
	pos[1] += Math.random() * this.size[1] - this.size[1] / 2;
	this.initialExplosion.explode(pos);
    }
    
    async explode() {
	// Explodes the ship. This happens when it's dead.
	// Temporary.
	var explodeInterval = false;
	if (this.initialExplosion) {
	    explodeInterval = setInterval(this._smallExplosion.bind(this, this.position), 100);
	}
	
	await new Promise(function(fulfill, reject) {
	    setTimeout(fulfill, 2000);
	});

	if (this.finalExplosion) {
	    this.finalExplosion.explode(this.position);
	}

	if (explodeInterval) {
	    clearInterval(explodeInterval);
	}

    }

    
    async _onDeath() {
	// Hide all sprites but baseImage
	for (let name in this.sprites) {
	    if (name !== "baseImage") {
		this.sprites[name].sprite.visible = false;
	    }
	}
	await this.explode();
	await super._onDeath(...arguments);

    }

    destroyOutfits() {
	_.each(this.outfits, function(o) {o.destroy();});
    }
    
    destroy() {
	this.destroyOutfits();
	super.destroy();
    }
}





if (typeof(module) !== 'undefined') {
    module.exports = ship;
}

