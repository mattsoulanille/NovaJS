function turretWeapon(name, source, meta, count) {
    basicWeapon.call(this, name, source, meta, count);
}
turretWeapon.prototype = new basicWeapon;

turretWeapon.prototype.fire = function() {
    if (this.target) {
	var x_diff = this.target.position[0] - this.source.position[0];
	var y_diff = this.target.position[1] - this.source.position[1];
    
	var directionToTarget = (Math.atan2(y_diff, x_diff) + 2*Math.PI) % (2*Math.PI);

	basicWeapon.prototype.fire.call(this, directionToTarget);


    }
}
