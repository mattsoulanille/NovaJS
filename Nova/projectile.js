function projectile(projName, physics) {
    // projectile != weapon since weapon will include beams and bays (launched ships)
    // one single projectile. Usually created en masse by a weapon.
    movable.call(this, projName)
    this.url = 'objects/projectiles/'
    this.pointing = 0
    this.available = false
    this.meta.physics = physics
}

projectile.prototype = new movable

projectile.prototype.build = function() {

    setAvailable = function() {
	this.available = true
    }

    spaceObject.prototype.build.call(this).then(_.bind(setAvailable, this))
    
}
// projectile.prototype.fire = function(direction, ship_position, ship_velocity) {
//     this.placeOnShip(direction, ship_position, ship_velocity)
// 	.then(this.show());

//     setTimeout(_.bind(this.end, this), this.meta.physics.duration * 1000/30);

// }

projectile.prototype.loadResources = function() {
    // would set this.meta.physics, but
    // this.meta.physics is given by weapon on construction.
    return new RSVP.Promise(function(fulfill, reject) {
	fulfill()
    });
}


projectile.prototype.fire = function(direction, position, velocity) {
    // temporary. Gun points will be implemented later
    // maybe pass the ship to the projectile... or not
    // inaccuracy is handled by weapon
    this.available = false;
    this.pointing = direction;
    this.position = _.map(position, function(x) {return x});
    var factor = 30/100;
    this.velocity = [Math.cos(direction) * this.meta.physics.speed * factor + velocity[0],
		     Math.sin(direction) * this.meta.physics.speed * factor + velocity[1]];
    this.render(); // update the projectile's sprite's properties with the new ones
    this.show();

    setTimeout(_.bind(this.end, this), this.meta.physics.duration * 1000/30);
    
//    this.
}

projectile.prototype.end = function() {
    this.velocity = [0,0];
    this.hide();
    this.available = true;
}


