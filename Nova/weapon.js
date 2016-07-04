function weapon(weaponName) {
    this.url = 'objects/weapons/'
    this.name = weaponName;
    this.firing = false;
    this.doAutoFire = false;
}

weapon.prototype.build = function() {
    
    $.getJSON(this.url + this.name + ".json", _.bind(function(data) {
	this.meta = data;
	console.log(data)
    
    }, this));

	    
    this.projectiles = [];

    // as many projectiles as can be in the air at once as a result of the weapon's
    // duration and reload times
    required_projectiles = this.meta.physics.duration % this.meta.properties.reload + 1;

    for (i=0; i < required_projectiles; i++) {
	proj = new projectile(this.name, this.meta.physics);
	this.projectiles.push(proj);
    }
    
    
    
}

weapon.prototype.fire = function() {
    // finds an available projectile and fires it
    for (i=0; i < this.projectiles.length; i++) {
	var proj = this.projectiles[i];
	if (proj.available) {
	    proj.fire()
	}

    }
}


weapon.prototype.startFiring = function() {
    if (this.firing) {
	this.doAutoFire = true
    }
    else {
	this.doAutoFire = true
	this.autoFire()
    }

}

weapon.prototype.stopFiring = function() {
    this.doAutoFire = false
}

weapon.autoFire = function() {
    if (this.doAutoFire) {
	this.firing = true
	// fire
	// fire again after reload time
	setTimeout(_.bind(this.autoFire, this), this.meta.physics.reload * 1/30)
    }
    else {
	this.firing = false
    }
}
