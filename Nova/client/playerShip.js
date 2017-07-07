if (typeof(module) !== 'undefined') {
    module.exports = playerShip;
    ship = require("./ship.js");
}


class playerShip extends ship {

    constructor(buildInfo, system) {
	super(buildInfo, system);
	this.pointing = Math.random()*2*Math.PI;
	this.velocity[0] = 0;
	this.velocity[1] = 0;
	this.isPlayerShip = true;
	this.weapons.primary = [];
	this.weapons.secondary = [];
	this.target = undefined;
	this.planetTarget = undefined;
	this.targetIndex = -1;

    }

    build() {

	return super.build.call(this)
	    .then(this.sortWeapons.bind(this))
	    .then(this.makeStatusBar.bind(this))
	    .then(function() {
		// Is this terrible practice? I'm not sure, but it's definitely insane.	    
		this.statechange = gameControls.onstatechange(this.statechange.bind(this));
		this.assignControls(gameControls);
	    }.bind(this));
    }



    sortWeapons() {

	_.each(this.weapons.all, function(weapon) {
	    
	    if (weapon.meta.properties.type === "primary") {
		this.weapons.primary.push(weapon);
		
	    }
	    else if (weapon.meta.properties.type === "secondary") {
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
	return this.statusBar.build()
    }

    receiveCollision(other) {
	ship.prototype.receiveCollision.call(this, other);
	this.sendCollision();
    }


    addSpritesToContainer() {
	_.each(_.map(_.values(this.sprites), function(s) {return s.sprite;}),
	       function(s) {this.container.addChild(s);}, this);
	this.hide()

	this.system.container.addChildAt(this.container, this.system.container.children.length) //playerShip is above all
    }



    firePrimary() {
	_.map(this.weapons.primary, function(weapon) {weapon.firing = true;});
    }
    stopPrimary() {
	_.map(this.weapons.primary, function(weapon) {weapon.firing = false;});
    }
    fireSecondary() {
	_.map(this.weapons.secondary, function(weapon) {weapon.firing = true;});
    }
    stopSecondary() {
	_.map(this.weapons.secondary, function(weapon) {weapon.firing = false;});
    }
    resetNav() {
	this.setPlanetTarget(undefined);
    }

    assignControls(c) {
	//There is no way this is good practice...
	this.firePrimary = c.onstart("primary", this.firePrimary.bind(this));
	
	this.stopPrimary = c.onend("primary", this.stopPrimary.bind(this));
	
	this.fireSecondary = c.onstart("secondary", this.fireSecondary.bind(this));
	
	this.stopSecondary = c.onend("secondary", this.stopSecondary.bind(this));
	
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
	    if ((typeof this.planetTarget !== 'undefined') && (lastPlanet === this.planetTarget)) {
		// try to land
		var p = this.planetTarget;
		var max_dist = Math.pow( ((p.size[0] + p.size[1]) / 4), 2 );
		var max_vel = 900;
		
		// planets can't move
		var vel = ( Math.pow(this.velocity[0], 2) + Math.pow(this.velocity[1], 2));
		var dist = (Math.pow( (this.position[0] - p.position[0]), 2) +
			    Math.pow( (this.position[1] - p.position[1]), 2));
		if ((vel <= max_vel) && (dist <= max_dist)) {
		    _.map(this.weapons.all, function(weapon) {weapon.stopFiring();});
		    this.land(this.planetTarget);
		    //		stopRender = true;
		    return;
		}
	    }
	}
	
	
	this.updateStats(stats);
	this.sendStats();
    }
    
    updateStats(stats = {}) {
	super.updateStats.call(this, stats);
    }

    sendStats() {
	var newStats = {};
	newStats[this.UUID] = this.getStats();
	this.socket.emit('updateStats', newStats);
    }

    render() {
	// -194 for the sidebar
	this.container.position.x = (screenW-194)/2;
	this.container.position.y = screenH/2;
	
	
	super.render.call(this);
	this.statusBar.render();
	
    }

    findNearest(items) {
	var get_distance = function(a, b) {
	    return Math.pow((a.position[0] - b.position[0]), 2) +
		Math.pow((a.position[1] - b.position[1]), 2);
	}
	
	var distances = {};
	items.forEach(function(t) {
	    var dist = get_distance(t, this);
	    distances[dist] = t;
	}.bind(this));
	
	var min = Math.min(...Object.keys(distances));
	if (min !== Infinity) {
	    return distances[min];
	}
    }

    
    targetNearest() {
	var targets = [];
	this.system.ships.forEach(function(s) {
	    if (s !== this) {
		targets.push(s);
	    }
	}.bind(this));
	
	var nearest = this.findNearest(targets);
	
	if ((typeof nearest !== 'undefined') && (this.target !== nearest)) {
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
	this.target = target;
	this.statusBar.setTarget(this.target)
	super.setTarget.call(this, this.target);
    }

    setPlanetTarget(planetTarget) {
	this.planetTarget = planetTarget;
	this.statusBar.setPlanetTarget(this.planetTarget);
    }


    land(planet) {
	this.polarVelocity = 0;
	this.velocity[0] = this.velocity[1] = 0;
	this.setTarget(undefined);
	planet.land();
    }

    cycleTarget() {
	// targetIndex goes from -1 (for no target) to ships.length - 1
	var targets = Array.from(this.system.built.ships).filter(function(v) {
	    return v !== this;
	}.bind(this));


	// loops from -1 to targets.length
	this.targetIndex = (this.targetIndex + 2) % (targets.length + 1) - 1;
	// If targetIndex === targets.length, then target is undefined, which is intentional
	this.setTarget(targets[this.targetIndex]);
	//    console.log(this.targetIndex)
    }

    onDeath() {
	// temporary respawn
	this.position[0] = 0;
	this.position[1] = 0;
	this.shield = this.properties.maxShields;
	this.armor = this.properties.maxArmor;
	var newStats = {};
	newStats[this.UUID] = this.getStats();
	this.socket.emit('updateStats', newStats);
	
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
