if (typeof(module) !== 'undefined') {
    module.exports = playerShip;
    ship = require("./ship.js");
}


function playerShip(buildInfo, system) {
    ship.call(this, buildInfo, system);
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

playerShip.prototype = new ship;

playerShip.prototype.build = function() {

    return ship.prototype.build.call(this)
	.then(this.sortWeapons.bind(this))
	.then(this.makeStatusBar.bind(this))
	.then(function() {
	    gameControls.onstatechange(this.onstatechange.bind(this));
	}.bind(this));
    
}


playerShip.prototype.sortWeapons = function() {

    _.each(this.weapons.all, function(weapon) {

	if (weapon.meta.properties.type === "primary") {
	    this.weapons.primary.push(weapon);
	    
	}
	else if (weapon.meta.properties.type === "secondary") {
	    this.weapons.secondary.push(weapon);
	    
	}

    }.bind(this));
    
}

playerShip.prototype.receiveCollision = function(other) {
    ship.prototype.receiveCollision.call(this, other);
    this.sendCollisionToServer();
}

playerShip.prototype.sendCollisionToServer = _.throttle(function() {
    if (typeof this.UUID !== 'undefined') {
	var stats = {};
	stats[this.UUID] = this.getStats();
    }
    this.socket.emit('updateStats', stats);
    
}, 1000);

playerShip.prototype.makeStatusBar = function() {
    this.statusBar = new statusBar('civilian', this);
    return this.statusBar.build()
}



playerShip.prototype.addToSpaceObjects = function() {
    this.system.built.spaceObjects.unshift(this);
    if (this.buildInfo.multiplayer) {
	this.system.built.multiplayer[this.buildInfo.UUID] = this;
    }

}

playerShip.prototype.addSpritesToContainer = function() {
    _.each(_.map(_.values(this.sprites), function(s) {return s.sprite;}),
	   function(s) {this.spriteContainer.addChild(s);}, this);
    this.hide()

    space.addChildAt(this.spriteContainer, space.children.length) //playerShip is above all
}

playerShip.prototype.onstatechange = function(state) {
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

    if (state.primary) {
	_.map(this.weapons.primary, function(weapon) {weapon.startFiring();});
    }
    else {
	_.map(this.weapons.primary, function(weapon) {weapon.stopFiring();});
    }

    this.turningToTarget = state["point to"];

    if (state.secondary) {
	_.map(this.weapons.secondary, function(weapon) {weapon.startFiring();});
    }
    else {
	_.map(this.weapons.secondary, function(weapon) {weapon.stopFiring();});
    }

    if (state["target nearest"]) {
	this.targetNearest();	
    }

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
		this.land(this.planetTarget);
	    }
	}
    }
    if (state["reset nav"]) {
	this.setPlanetTarget(undefined);
    }
    
    this.updateStats(stats);
    this.sendStats();
}

playerShip.prototype.updateStats = function(stats = {}) {
    ship.prototype.updateStats.call(this, stats);
    
}

playerShip.prototype.sendStats = function() {
    var newStats = {};
    newStats[this.UUID] = this.getStats();
    this.socket.emit('updateStats', newStats);
}


playerShip.prototype.render = function() {
    // -194 for the sidebar
    this.spriteContainer.position.x = (screenW-194)/2;
    this.spriteContainer.position.y = screenH/2;


    ship.prototype.render.call(this);
    this.statusBar.render();

}

playerShip.prototype.findNearest = function(items) {
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
    
playerShip.prototype.targetNearest = function() {
    var targets = [];
    this.system.ships.forEach(function(s) {
	if (s !== this) {
	    targets.push(s);
	}
    }.bind(this));

    var nearest = this.findNearest(targets);

    if ((typeof nearest !== 'undefined') && (this.target !== nearest)) {
	this.targetIndex = this.system.ships.indexOf(nearest);
	this.setTarget(nearest);
    }
}
    
playerShip.prototype.targetNearestPlanet = function() {

    var nearest = this.findNearest(this.system.planets);
    if (this.planetTarget !== nearest) {
	this.setPlanetTarget(nearest);
    }

}

playerShip.prototype.setTarget = function(target) {
    this.target = target;
    this.statusBar.setTarget(this.target)
    ship.prototype.setTarget.call(this, this.target);
    
}

playerShip.prototype.setPlanetTarget = function(planetTarget) {
    this.planetTarget = planetTarget;
    this.statusBar.setPlanetTarget(this.planetTarget);
}


playerShip.prototype.land = function(planet) {

}
    

playerShip.prototype.cycleTarget = function() {
    // targetIndex goes from -1 (for no target) to ships.length - 1
    var incrementTargetIndex = function() {
	this.targetIndex = (this.targetIndex + 2) % (this.system.ships.length + 1) - 1;
	// super cheapo temporary way to not target the player ship (ship 0)
	if (this.targetIndex === 0) {
	    this.targetIndex = (this.targetIndex + 2) % (this.system.ships.length + 1) - 1;
	}
    }.bind(this);

    incrementTargetIndex();

    // If targetIndex === -1, then target is undefined, which is intentional
    this.setTarget(this.system.ships[this.targetIndex]);
//    console.log(this.targetIndex)

    
}


playerShip.prototype.addToSystem = function() {};

playerShip.prototype.onDeath = function() {
    // temporary respawn
    this.position[0] = 0;
    this.position[1] = 0;
    this.shield = this.properties.maxShields;
    this.armor = this.properties.maxArmor;
    var newStats = {};
    newStats[this.UUID] = this.getStats();
    this.socket.emit('updateStats', newStats);

}
