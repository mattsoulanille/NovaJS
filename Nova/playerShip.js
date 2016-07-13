function playerShip(shipName, outfits) {
    ship.call(this, shipName, outfits);
    this.pointing = Math.random()*2*Math.PI;
    this.velocity[0] = 0;
    this.velocity[1] = 0;
    this.isPlayerShip = true;
    this.weapons.primary = [];
    this.weapons.secondary = [];
    this.target = undefined;
    this.targetIndex = -1;
}

playerShip.prototype = new ship

playerShip.prototype.build = function() {

    return ship.prototype.build.call(this)
	.then(this.sortWeapons.bind(this))
	.then(this.makeStatusBar.bind(this))
    
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

playerShip.prototype.makeStatusBar = function() {
    this.statusBar = new statusBar('civilian', this);
    return this.statusBar.build()
}



playerShip.prototype.addToSpaceObjects = function() {
    spaceObjects.unshift(this);
}

playerShip.prototype.addSpritesToContainer = function() {
    _.each(_.map(_.values(this.sprites), function(s) {return s.sprite;}),
	   function(s) {this.spriteContainer.addChild(s);}, this);
    this.hide()

    stage.addChildAt(this.spriteContainer, stage.children.length) //playerShip is above all
}

playerShip.prototype.updateStats = function() {
    var keys = KeyboardJS.activeKeys();
    var turning;
    var accelerating;
    if (_.contains(keys, 'right') && !_.contains(keys, 'left')) {
	turning = 'right';
    }
    else if (_.contains(keys, 'left') && !_.contains(keys, 'right')) {
	turning = 'left';
    }
    else {
	turning = '';
    }
    if (_.contains(keys, 'down')) {
	accelerating = -1;
    }
    else if (_.contains(keys, 'up')) {
	accelerating = 1;
    }
    else {
	accelerating = 0;
    }
    if (_.contains(keys, 'space')) {
	_.map(this.weapons.primary, function(weapon) {weapon.startFiring();});

    }
    else {
	_.map(this.weapons.primary, function(weapon) {weapon.stopFiring();});
    }



    ship.prototype.updateStats.call(this, turning, accelerating);

}

playerShip.prototype.render = function() {
    // -194 for the sidebar
    this.spriteContainer.position.x = (screenW-194)/2;
    this.spriteContainer.position.y = screenH/2;
    
    ship.prototype.render.call(this);
    this.statusBar.render();

}

playerShip.prototype.cycleTarget = function() {
    // targetIndex goes from -1 (for no target) to ships.length - 1
    this.targetIndex = (this.targetIndex + 2) % (ships.length + 1) - 1; // only ships are targets

    // If targetIndex === -1, then target is undefined, which is intentional
    this.target = ships[this.targetIndex];
//    console.log(this.targetIndex)
    this.statusBar.cycleTarget(this.target)
    
}
