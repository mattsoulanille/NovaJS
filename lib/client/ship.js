var acceleratable = require("../server/acceleratableServer.js");
var turnable = require("../server/turnableServer.js");
var damageable = require("../server/damageableServer.js");
var collidable = require("../server/collidableServer.js");
var movable = require("../server/movableServer.js");
var spaceObject = require("../server/spaceObjectServer.js");
var _ = require("underscore");
//var Promise = require("bluebird");
var outfit = require("../server/outfitServer.js");
var weaponBuilder = require("../server/weaponBuilderServer.js");
var exitPoint = require("./exitPoint.js");
var errors = require("../client/errors.js");
var UnsupportedWeaponTypeError = errors.UnsupportedWeaponTypeError;
var explosion = require("./explosion.js");
var PIXI = require("../server/pixistub.js");
var ionizable = require("../server/ionizableServer.js");

const AFTERBURNER_ACCEL_FACTOR = 1.6;
const AFTERBURNER_SPEED_FACTOR = 1.4;

ship = class extends ionizable(acceleratable(turnable(damageable(collidable(movable(spaceObject)))))) {
    constructor(buildInfo, system) {
	super(...arguments);
	//this.url = 'objects/ships/';
	this.type = 'ships';
	this.pointing = 0;
	this.weapons = {};
	this.weapons.all = [];
	this.outfits = [];
	this.escorts = {};
	this.escorts.all = [];
	
	this.turningToTarget = false;
	this.landedOn = null;
	if (typeof(buildInfo) !== 'undefined') {
	    //this.outfitList = buildInfo.outfits || [];
	    this.buildInfo.type = "ship";
	}


	// Don't automatically die when the client thinks it has zero armor.
	// Get confirmation from the server.
	this.offState("zeroArmor", this._onDeathBound);
	this.usingAfterburner = false;
    }

    _bindListeners() {
	this.multiplayer.on("setOutfits", this._setOutfitsListener.bind(this));
    }


    // set usingAfterburner(v) {
    // 	if (typeof v === "undefined") {
    // 	    throw new Error("got it");
    // 	}
    // 	this._usingAfterburner = v;
    // }
    // get usingAfterburner() {
    // 	return this._usingAfterburner;
    // }


    
    async _build() {
	await super._build();
	this.buildTargetImage();
	
	this.buildExitPoints();
	await this.buildOutfits();
	this.checkMass(this.outfits);
	await this.buildExplosion();
	
	this.energy = this.properties.energy;
	if (this.system) {
	    this.system.built.ships.add(this);
	}
	this._bindListeners();
    }

    checkMass(outfits) {
	var outfitMass = this.outfits.map(function(outf) {
	    if (outf.meta.mass) {
		return outf.meta.mass * outf.count;
	    }
	    else {
		return 0;
	    }
	}).reduce(function(a, b) {return a + b;}, 0);

	this.properties.freeMass = this.meta.freeMass - outfitMass;
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

	this.checkMass(this.outfits);
    }



    setProperties() {
	super.setProperties();
	this.properties.vulnerableTo = ["normal"];
	this.properties.afterburnerFuel = null;
    }

    _getAcceleration() {
	if (this.getState("afterburner")) {
	    return super._getAcceleration() * AFTERBURNER_ACCEL_FACTOR;
	}
	else {
	    return super._getAcceleration();
	}
    }
    _getMaxSpeed() {
	if (this.getState("afterburner")) {
	    return super._getMaxSpeed() * AFTERBURNER_SPEED_FACTOR;
	}
	else {
	    return super._getMaxSpeed();
	}
    }

    getOutfits() {
	return this.multiplayer.query("getOutfits"); // a promise
    }

        
    addSpritesToContainer() {

	// adds sprites to the container in the correct order to have proper
	// layering of engine, ship, lights etc.
	// Also set the correct blend mode
	//var orderedSprites = [this.sprites.baseImage.sprite];
	var orderedSprites = [];
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

	// It just so happens that all the sprites without order are solid (blendmode overlay)
	_.each(without, function(x) {this.solidContainer.addChild(x);}, this);

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
	if (typeof stats.usingAfterburner !== "undefined") {
	    this.usingAfterburner = stats.usingAfterburner;
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
	stats.usingAfterburner = this.usingAfterburner;
	return stats;
    }


    turnToTarget() {
	if (this.target) {
	    var direction = this.position.angle(this.target.position);
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

    doAfterburnerFuelDrain(delta) {
	// Note that afterburners can have different fuel drains
	// depending on which outfit provides them.
	// afterburnerFuel is in units / second
	if (this.properties.afterburnerFuel == null) {
	    // No afterburner
 	    return false;
	}

	var cost = (this.properties.afterburnerFuel / 1000) * delta;
	if (this.energy < cost) {
	    return false;
	}
	else {
	    this.energy -= cost;
	    return true;
	}
	
    }
    
    render(delta) {
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
	
	
	if (this.properties.energyRecharge) {
	    this.energy = Math.min(this.properties.energy,
				   this.energy + this.properties.energyRecharge * 60/1000 * delta);
	}

	if (this.usingAfterburner) {
	    let canAfford = this.doAfterburnerFuelDrain(delta);
	    this.setState("afterburner", canAfford);
	    if (canAfford) {
		this.accelerating = 1;
	    }
	}
	else {
	    this.setState("afterburner", false);
	}
	
	super.render(...arguments);
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

    _initialExplosion() {
	var explBox = [this.size[0] / 2, this.size[1] / 2];
	var pos = [...this.position];
	pos[0] += Math.random() * explBox[0] - explBox[0] / 2;
	pos[1] += Math.random() * explBox[1] - explBox[1] / 2;
	this.initialExplosion.explode(pos);
    }

    _smallFinalExplosion() {
	this.finalExplosion.explode(this.position);
    }

    _largeFinalExplosion() {
	for (let i = 0; i < 8; i++) {
	    let offset = this._randomCirclePoint(this.size[0] / 4);
	    let pos = [this.position[0] + offset[0],
		       this.position[1] + offset[1]];
	    let delay = Math.round(Math.random() * 100);
	    this.finalExplosion.explode(pos, delay);
	}
    }

    async explode() {
	// Explodes the ship. This happens when it's dead.
	// Temporary.
	var explodeInterval = false;
	if (this.initialExplosion) {
	    explodeInterval = setInterval(this._initialExplosion.bind(this, this.position), 100);
	}

	await this.sleep(this.properties.deathDelay);

	if (this.finalExplosion) {
	    if (this.properties.largeExplosion) {
		this._largeFinalExplosion();
	    }
	    else {
		this._smallFinalExplosion();
	    }
	}

	
	if (explodeInterval) {
	    clearInterval(explodeInterval);
	}

    }

    
    async _onDeath() {
	await this.explode();
	this.hide();
	await super._onDeath(...arguments);

    }

    destroyOutfits() {
	_.each(this.outfits, function(o) {o.destroy();});
    }
    
    _destroy() {
	this.destroyOutfits();
	super._destroy();
    }
};





if (typeof(module) !== 'undefined') {
    module.exports = ship;
}

