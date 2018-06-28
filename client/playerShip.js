var _ = require("underscore");
var ship = require("./ship.js");
var controllable = require("./controllable.js");
var explosion = require("./explosion.js");
var statusBar = require("./statusBar.js");
var errors = require("../client/errors.js");
var ControlScopeError = errors.ControlScopeError;

class playerShip extends controllable(ship) {

    constructor(buildInfo, system) {
	super(...arguments);
	this.pointing = Math.random()*2*Math.PI;
	this.velocity[0] = 0;
	this.velocity[1] = 0;
	this.isPlayerShip = true;
	this.weapons.primary = [];
	this.weapons.secondary = [];
	this.weapons.currentSecondary = null;
	this.planetTarget = null;
	this.targetIndex = -1;
	this.secondaryIndex = -1;
	this.firingSecondary = false;
	this.scope = "playerShip";
	//this.sendTimeout;

	// Ship removed this. We are responsable for
	// reporting when playerShip dies.
	this.onState("zeroArmor", this._onDeathBound);
    }

    async _build() {

	await super._build();
	await this.makeStatusBar();
	this.bindControls();
    }


    async buildOutfits() {
	this.weapons.primary = [];
	this.weapons.secondary = [];
	this.weapons.currentSecondary = null;
	await super.buildOutfits();
	this.sortWeapons();	
    }

    addOutfit(newOutfit, send = true) {
	// Temporary and linear time. Bad

	for (let i in this.properties.outfits) {
	    var o = this.properties.outfits[i];
	    if (newOutfit.id == o.id) {
		o.count += newOutfit.count;
		if (send) {
		    this.setOutfits(this.properties.outfits);
		}
		return;
	    }
	}

	this.properties.outfits.push(newOutfit);
	if (send) {
	    this.setOutfits(this.properties.outfits);
	}
    }

    removeOutfit(oldOutfit, send = true) {
	for (let i in this.properties.outfits) {
	    var o = this.properties.outfits[i];
	    if (oldOutfit.id == o.id) {
		o.count -= oldOutfit.count;
		if (o.count <= 0)  {
		    // Maybe outfits should be a set? but that's not quite right either.
		    // Maybe an object.
		    this.properties.outfits.splice(i, 1);
		}
		if (send) {
		    this.setOutfits(this.properties.outfits);
		}
		return true;
	    }
	}
	return false;
    }
    

    async setOutfits(outfitList = this.properties.outfits) {
	// Asks the server to set the ships outfits to outfitList
	this.multiplayer.privateEmit("setOutfits", outfitList);
    }

    
    sortWeapons() {

	_.each(this.weapons.all, function(weapon) {
	    
	    if (weapon.properties.fireGroup === "primary") {
		this.weapons.primary.push(weapon);
		
	    }
	    else if (weapon.properties.fireGroup === "secondary") {
		this.weapons.secondary.push(weapon);
		
	    }
	    
	}.bind(this));
    }

    receiveCollision(other) {
	super.receiveCollision.call(this, other);
	this.sendCollision();
    }


    makeStatusBar() {
	this.statusBar = new statusBar('civilian', this);
	return this.statusBar.build();
    }

    firePrimary() {
	_.map(this.weapons.primary, function(weapon) {weapon.firing = true;});
    }
    stopPrimary() {
	_.map(this.weapons.primary, function(weapon) {weapon.firing = false;});
    }
    fireSecondary() {
	this.firingSecondary = true;
	if (this.weapons.currentSecondary) {
	    this.weapons.currentSecondary.firing = true;
	}
    }
    stopSecondary() {
	this.firingSecondary = false;
	if (this.weapons.currentSecondary) {
	    this.weapons.currentSecondary.firing = false;
	}
    }

    setSecondary(weap) {
	if (this.weapons.currentSecondary) {
	    this.weapons.currentSecondary.firing = false;
	}

	this.weapons.currentSecondary = weap;
	if (weap) {
	    weap.firing = this.firingSecondary;
	}
	this.statusBar.setSecondary(weap);
    }
    
    cycleSecondary() {
	this.secondaryIndex = (this.secondaryIndex + 2) % (this.weapons.secondary.length + 1) - 1;
	if (!this.weapons.secondary[this.secondaryIndex]) {
	    this.setSecondary(null);
	}
	else {
	    this.setSecondary(this.weapons.secondary[this.secondaryIndex]);
	}
    }

    resetSecondary() {
	this.secondaryIndex = -1;
	this.setSecondary(null);
    }
    
    resetNav() {
	this.setPlanetTarget(null);
    }

    bindControls() {

	var c = this.controls; // is gameControls as defined in controllable

	this.boundControls = [
	    c.onStateChange(this.scope, this.statechange.bind(this)),
	    c.onStart(this.scope, "primary", this.firePrimary.bind(this)),
	    c.onEnd(this.scope, "primary", this.stopPrimary.bind(this)),
	    c.onStart(this.scope, "secondary", this.fireSecondary.bind(this)),
	    c.onEnd(this.scope, "secondary", this.stopSecondary.bind(this)),

	    c.onStart(this.scope, "cycle secondary", this.cycleSecondary.bind(this)),
	    c.onStart(this.scope, "reset secondary", this.resetSecondary.bind(this)),
	
	    c.onStart(this.scope, "target nearest", this.targetNearest.bind(this)),
	    c.onStart(this.scope, "target", this.cycleTarget.bind(this)),
	    c.onStart(this.scope, "reset nav", this.resetNav.bind(this))
	];
    }

    
    statechange(state) {
	//make this into a builder function and make it 
	
	var stats = {};
	
	//xnor
	if (! (state.right ^ state.left) ) {
	    stats.turning = '';
	}
	else if (state.right) {
	    stats.turning = 'right';
	}
	else {
	    stats.turning = 'left';
	}
	
	if (state.reverse) {
	    stats.accelerating = -1;
	}
	else if (state.accelerate) {
	    stats.accelerating = 1;
	}
	else {
	    stats.accelerating = 0;
	}
	this.turningToTarget = state["point to"];
	
	
	if (state.land) {
	    var lastPlanet = this.planetTarget;
	    this.targetNearestPlanet();
	    if (this.planetTarget && (lastPlanet === this.planetTarget)) {
		this.land(this.planetTarget); // tries to land
	    }
	}
	
	
	this.updateStats(stats);
	this.sendStats();
    }

    land(planet) {
	if (planet.land(this)) {
	    this.landedOn = planet;
	    this.polarVelocity = 0;
	    this.velocity[0] = this.velocity[1] = 0;
	    this.setTarget(null);
	    this.setPlanetTarget(null);
	    this.hide();
	}
    }
    depart(planet) {
	this.landedOn = null;
	this.position[0] = planet.position[0];
	this.position[1] = planet.position[1];
	this.pointing = Math.random() * 2*Math.PI;
	this.shield = this.properties.shield;
	this.armor = this.properties.armor;
	this.ionization = 0;
	this.show();
    }

    show() {
	super.show();
    }
    
    updateStats(stats = {}) {
	super.updateStats.call(this, stats);
    }

    _addToContainer() {
	global.space.addChild(this.container);
    }

    _removeFromContainer() {
	global.space.removeChild(this.container);
    }

    
    render() {
	// -194 for the sidebar


	this.container.position.x = (global.screenW - 194) / 2;
	this.container.position.y = global.screenH/2;

	super.render(...arguments);

	this.system.container.position.x = - this.position[0] + (global.screenW - 194) / 2;
	this.system.container.position.y = this.position[1] + global.screenH / 2;

	this.statusBar.render(...arguments);
	
    }


    
    targetNearest() {
	var targets = [];
	this.system.targetable.forEach(function(s) {
	    if (s !== this) {
		targets.push(s);
	    }
	}.bind(this));
	
	var nearest = this.findNearest(targets);
	
	if (nearest && (this.target !== nearest)) {
	    this.targetIndex = Array.from(this.system.ships).indexOf(nearest);
	    this.setTarget(nearest);
	}
    }
    
    targetNearestPlanet() {
	
	var nearest = this.findNearest(this.system.planets);
	if (this.planetTarget !== nearest) {
	    this.setPlanetTarget(nearest);
	}
    }	

    setTarget(target) {
	super.setTarget(target);
	this.statusBar.setTarget(this.target);

    }

    setPlanetTarget(planetTarget) {
	this.planetTarget = planetTarget;
	this.statusBar.setPlanetTarget(this.planetTarget);
    }

    

    cycleTarget() {
	// targetIndex goes from -1 (for no target) to ships.length - 1
	var targets = Array.from(this.system.targetable).filter(function(v) {
	    return v !== this;
	}.bind(this));


	// loops from -1 to targets.length
	this.targetIndex = (this.targetIndex + 2) % (targets.length + 1) - 1;

	if (targets[this.targetIndex]) {
	    this.setTarget(targets[this.targetIndex]);
	}
	else {
	    this.setTarget(null);
	}
	//    console.log(this.targetIndex)
    }

    async _onDeath() {
	// temporary respawn
	this.sendStats(); // send that we died
	await super._onDeath(...arguments);
	this.respawn();
    }

    respawn() {
	// Set that it has armor again.
	this.setState("zeroArmor", false);
	
	this.position[0] = Math.random() * 1000 - 500;
	this.position[1] = Math.random() * 1000 - 500;
	this.velocity[0] = 0;
	this.velocity[1] = 0;
	this.shield = this.properties.shield;
	this.armor = this.properties.armor;
	this.ionization = 0;
	//var newStats = {};
	//newStats[this.UUID] = this.getStats();
	//this.socket.emit('updateStats', newStats);
	this.show();
	this.sendStats();

    }
    
    set send(v) {
	if (v) {
	    if (!this.sendInterval) {
		this.sendInterval = setInterval(this.sendStats.bind(this), 1000);
	    }
	}
	else {
	    if (this.sendInterval) {
		clearInterval(this.sendInterval);
		this.sendInterval = false;
	    }
	}
	
    }
    get send() {
	return Boolean(this.sendInterval);
    }

    _addToRendering() {
	// so it renders first. A bit insane and hacky
	this.system.built.render = new Set([this,...this.system.built.render]);
    }
        
    _addToSystem() {
        super._addToSystem();
	this.send = true;
    }
    _removeFromSystem() {
	this.send = false;
	super._removeFromSystem();
    }

    destroy() {
	try {
	    this.unbindControls();

	    // Don't remove this scope when unbinding controls since there is going
	    // to be another ship to control. Fix this probably
	    this.controls.pushScope(this.scope);

	}
	catch (e) {
	    // A ControlScopeError is expected since we're
	    // trying to pop the scope from this object we're
	    // destroying, which may be destroyed at any time,
	    // not just when it has the control scope.
	    // See controllable.js
	    if (! (e instanceof ControlScopeError) ) {
		throw e;
	    }
	}
	this.statusBar.destroy();
	super.destroy.call(this);
    }
}



playerShip.prototype.sendCollision = _.throttle(function() {
    if (typeof this.UUID !== 'undefined') {
	var stats = {};
	stats[this.UUID] = this.getStats();
    }
    this.socket.emit('updateStats', stats);
    
}, 100);
module.exports = playerShip;
