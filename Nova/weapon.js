function weapon(weaponName, source, count) {
    this.url = 'objects/weapons/'
    this.name = weaponName;
    this.firing = false;
    this.doAutoFire = false;
    this.source = source;
    this.count = count || 1
    this.ready = false;

}

weapon.prototype.build = function() {
    return this.loadResources()
	.then(_.bind(this.buildProjectiles, this))
	.then(_.bind(function() {
	    this.ready = true
	    this.source.weapons.all.push(this)
	}, this));

}

weapon.prototype.loadResources = function() {
    return new Promise( function(fulfill, reject) {
	
	$.getJSON(this.url + this.name + ".json", _.bind(function(data) {

	    this.meta = data;

	    if ((typeof(this.meta) !== 'undefined') && (this.meta !== null)) {
		fulfill();
	    }
	    else {
		reject();
	    }


	}, this));


    }.bind(this));
}

weapon.prototype.buildProjectiles = function() {

    this.projectiles = [];
    // as many projectiles as can be in the air at once as a result of the weapon's
    // duration and reload times
    var required_projectiles = this.count * (Math.floor(this.meta.physics.duration /
							this.meta.properties.reload) + 1);
    var meta = {} // for the projectiles
    meta.imageAssetsFiles = this.meta.imageAssetsFiles;
    meta.physics = this.meta.physics;
    meta.properties = this.meta.properties
    //console.log(meta)

    for (i=0; i < required_projectiles; i++) {
	if (!(this.meta.physics.type)){
	    this.meta.physics.type = 'unguided';
	}
	var proj;
	switch (this.meta.physics.type) {
	case "unguided":
	    proj = new projectile(this.name, meta, this.source);
	    break;
	case "guided":
	    proj = new guided(this.name, meta, this.source);
	    break;
	}

	this.projectiles.push(proj);
    }
    
    return Promise.all(_.map( this.projectiles, function(projectile) {projectile.build()} ));

}


weapon.prototype.fire = function() {
    // finds an available projectile and fires it
    for (i=0; i < this.projectiles.length; i++) {
	var proj = this.projectiles[i];
	if (proj.available) {
	    var direction = this.source.pointing +
		((Math.random() - 0.5) * 2 * this.meta.properties.accuracy) *
		(2 * Math.PI / 360);
	    var position = this.source.position;
	    var velocity = this.source.velocity;
	    proj.fire(direction, position, velocity, this.target)
	    return true
	}

    }
    return false
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

weapon.prototype.autoFire = function() {
    if (this.doAutoFire) {
	this.firing = true
	
	// fire
	this.fire()
	
	// fire again after reload time
	var reloadTimeMilliseconds = this.meta.properties.reload * 1000/30 / this.count;
	setTimeout(_.bind(this.autoFire, this), reloadTimeMilliseconds)
    }
    else {
	this.firing = false
    }
}

weapon.prototype.cycleTarget = function(target) {
    this.target = target;
}
