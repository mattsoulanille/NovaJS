function projectile(projName) {
    //projectile != weapon since weapon will include beams and bays (launched ships)
    movable.call(this, projName)
    this.url = 'objects/projectiles/'
    this.pointing = 0
}

projectile.prototype = new movable

projectile.prototype.fire = function(direction, ship_position, ship_velocity) {
    
    
}
    
