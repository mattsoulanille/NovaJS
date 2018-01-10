if (typeof(module) !== 'undefined') {
    module.exports = playerShip;
    ship = require("./ship.js");
}


class playerShip extends ship {

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
	//this.sendTimeout;

    }

    async _build() {

	await super._build();
	this.sortWeapons();
	await this.makeStatusBar();
	// Is this terrible practice? I'm not sure, but it's definitely insane.	    
	this.statechange = gameControls.onstatechange(this.statechange.bind(this));
	this.assignControls(gameControls);
	//this.sendInterval = setInterval(this.sendStats.bind(this), 1000);

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

    receiveCollision(other) {
	ship.prototype.receiveCollision.call(this, other);
	this.sendCollision();
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

    assignControls(c) {
	// There is no way this is good practice...
	// Looking back on this a year or two later, I have no idea how it works.
	this.firePrimary = c.onstart("primary", this.firePrimary.bind(this));
	this.stopPrimary = c.onend("primary", this.stopPrimary.bind(this));
	
	this.fireSecondary = c.onstart("secondary", this.fireSecondary.bind(this));
	this.stopSecondary = c.onend("secondary", this.stopSecondary.bind(this));

	this.cycleSecondary = c.onstart("cycle secondary", this.cycleSecondary.bind(this));
	this.resetSecondary = c.onstart("reset secondary", this.resetSecondary.bind(this));
	
	this.targetNearest = c.onstart("target nearest", this.targetNearest.bind(this));
	this.cycleTarget = c.onstart("target", this.cycleTarget.bind(this));
	this.resetNav = c.onstart("reset nav", this.resetNav.bind(this));
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
	this.show();
    }
    
    updateStats(stats = {}) {
	super.updateStats.call(this, stats);
    }

    _addToContainer() {
	space.addChild(this.container);
    }

    _removeFromContainer() {
	space.removeChild(this.container);
    }

    
    render() {
	// -194 for the sidebar

	this.container.position.x = (screenW-194)/2;
	this.container.position.y = screenH/2;

		
	super.render(...arguments);

	this.system.container.position.x = - this.position[0] + (screenW - 194) / 2;
	this.system.container.position.y = this.position[1] + screenH / 2;

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

    onDeath() {
	// temporary respawn
	this.position[0] = Math.random() * 1000 - 500;
	this.position[1] = Math.random() * 1000 - 500;
	this.velocity[0] = 0;
	this.velocity[1] = 0;
	this.shield = this.properties.shield;
	this.armor = this.properties.armor;
	var newStats = {};
	newStats[this.UUID] = this.getStats();
	this.socket.emit('updateStats', newStats);
	
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
	var controlFunctions = [this.firePrimary, this.stopPrimary,
				this.fireSecondary, this.stopSecondary,
				this.targetNearest, this.cycleTarget,
				this.resetNav, this.statechange];
	
	controlFunctions.forEach(function(k) {
	    gameControls.offall(k);
	});
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
