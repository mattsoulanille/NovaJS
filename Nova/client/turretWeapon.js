if (typeof(module) !== 'undefined') {
    module.exports = turretWeapon;
    var basicWeapon = require("./basicWeapon.js");
    var _ = require("underscore");
    var Promise = require("bluebird");
}


function turretWeapon(buildInfo, source, socket) {
    basicWeapon.call(this, buildInfo, source);
}
turretWeapon.prototype = new basicWeapon;

turretWeapon.prototype.fire = function() {
    if (this.target) {
	var x_diff = this.target.position[0] - this.source.position[0];
	var y_diff = this.target.position[1] - this.source.position[1];
    
	var directionToTarget = (Math.atan2(y_diff, x_diff) + 2*Math.PI) % (2*Math.PI);

	var fireAngle = this.calcFireAngle() || directionToTarget;

	// weapon inaccuracy
	fireAngle += ((Math.random() - 0.5) * 2 * this.meta.properties.accuracy) *
		(2 * Math.PI / 360);
	
	basicWeapon.prototype.fire.call(this, fireAngle);

    }
}

turretWeapon.prototype.calcFireAngle = function() {
    var dx = this.target.position[0] - this.source.position[0];
    var dy = this.target.position[1] - this.source.position[1];
    var dvx = this.target.velocity[0] - this.source.velocity[0];
    var dvy = this.target.velocity[1] - this.source.velocity[1];
    // 1 nova projectile speed = 100 pixels / frame. 3/10 pixels / ms
    var factor = 3 / 10;
    var speed = this.meta.physics.speed * factor;

    // see https://www.reddit.com/r/gamedev/comments/16ceki/turret_aiming_formula/c7vbu2j
    // and use math
    var a = dvx*dvx + dvy*dvy - speed*speed;
    var b = 2*(dvx*dx + dvy*dy);
    var c = dx*dx + dy*dy;

    var discriminant = Math.pow(b,2) - 4*a*c;
    
    var hitTime; // calculated time between projectile fire and projectile hit
    var fireAngle;
    if (discriminant >= 0) {
	var times = [(-b + Math.sqrt(discriminant)) / (2*a),
		     (-b - Math.sqrt(discriminant)) / (2*a)];
	if (times[0] < 0) { times.shift() }
	if (times[1] < 0) { times.pop() }
	    
	hitTime = Math.min(...times); // ... means 'use elements of array as arguments'



	var hitPosition = [dx + dvx * hitTime, dy + dvy * hitTime];

	fireAngle = (Math.atan2(hitPosition[1], hitPosition[0]) + 2*Math.PI) % (2*Math.PI);
    }
    
    return fireAngle;
}
