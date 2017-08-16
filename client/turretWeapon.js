if (typeof(module) !== 'undefined') {
    var basicWeapon = require("../server/basicWeaponServer.js");
    var _ = require("underscore");
    var Promise = require("bluebird");
}


turretWeapon = class extends basicWeapon {

    constructor(buildInfo, source) {
	super(buildInfo, source);
	this.fireWithoutTarget = false;
	// [front, sides, back]. false means not blind
	this.blindspots = [false, false, false]; 
	if (typeof this.buildInfo !== 'undefined') {
	    if (typeof this.buildInfo.blindspots !== 'undefined') {
		_.each(this.buildInfo.blindspots, function(value, key) {
		    switch (key) {
		    case "front":
			this.blindspots[0] = value;
			break;
		    case "sides":
			this.blindspots[1] = value;
			break;
		    case "back":
			this.blindspots[2] = value;
			break;
		    }
		    
		}.bind(this));
	    } //closes if typeof this.buildInfo.blindspots...
	} // closes if typeof this.buildInfo !==...
	
    }

    fire(defaultFireAngle = 0) {
	// defaultFireAngle is relative to this.source and is only applied if the
	// target is in a blindspot (or nonexistant)
	var fireAngle = this.source.pointing;

	
	if (this.target) {
	    var position = this.exitPoints[this.exitIndex].position;
	    this.exitIndex = (this.exitIndex + 1) % this.exitPoints.length;

	    var x_diff = this.target.position[0] - position[0];
	    var y_diff = this.target.position[1] - position[1];
	    var directionToTarget = (Math.atan2(y_diff, x_diff) + 2*Math.PI) % (2*Math.PI);
	    
	    // if there are any blindspots
	    if (!this.checkBlindspots(directionToTarget)) {
		
		
		fireAngle = (this.calcFireAngle(position) || directionToTarget);
		fireAngle += (((Math.random() - 0.5) * 2 * this.properties.accuracy) *
			      (2 * Math.PI / 360));
		
		fireAngle = (fireAngle + 2*Math.PI) % (2*Math.PI);
		return super.fire.call(this, fireAngle, position);
	    }
	    
	}
	
	if (this.fireWithoutTarget) {
	    // used for quadrant turrets
	    fireAngle = (defaultFireAngle + fireAngle);
	    fireAngle += (((Math.random() - 0.5) * 2 * this.properties.accuracy) *
			  (2 * Math.PI / 360));
	    
	    fireAngle = (fireAngle + 2*Math.PI) % (2*Math.PI);
	    return super.fire.call(this, fireAngle);
	}
    }
    autoFire() {
	super.autoFire();
	    
    }
    checkBlindspots(directionToTarget) {
	// returns true if target is in a blindspot
	if (_.any(this.blindspots)) {
	    
	    
	    var closeEnough = function(a1, a2) {
		// assumes a1 and a2 are [0,2pi)
		var maxAngle = 45/360 * 2*Math.PI;
		var diff = (a1 - a2 + 2*Math.PI) % (2*Math.PI);
		return (diff <= maxAngle) || (diff >= (2*Math.PI - maxAngle));
		
	    }
	    
	    // check sides blind spot
	    var leftSide = (this.source.pointing + Math.PI / 2) % (2*Math.PI);
	    var rightSide = (this.source.pointing + Math.PI * 3 / 2) % (2*Math.PI);
	    if (this.blindspots[1] &&
		(closeEnough(directionToTarget, leftSide) ||
		 closeEnough(directionToTarget, rightSide))) {
		return true;
	    }
	    
	    // check back blind spot
	    var back = (this.source.pointing + Math.PI) % (2*Math.PI);
	    if (this.blindspots[2] &&
		closeEnough(directionToTarget, back)) {
		return true;
	    }
	    
	    // check front blindspot
	    if (this.blindspots[0] && // this.blindspots[0] = true means it's a blindspot
		closeEnough(directionToTarget, this.source.pointing)) {
		return true;
	    }
	    
	    
	}
	return false;
	
    }
    
    calcFireAngle(position) {
	var dx = this.target.position[0] - position[0];
	var dy = this.target.position[1] - position[1];
	var dvx = this.target.velocity[0] - this.source.velocity[0];
	var dvy = this.target.velocity[1] - this.source.velocity[1];
	// 1 nova projectile speed = 100 pixels / frame. 3/10 pixels / ms
	var factor = 3 / 10;
	var speed = this.properties.speed * factor;
	
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
	    
	    if (hitTime >= 0) {
		var hitPosition = [dx + dvx * hitTime, dy + dvy * hitTime];
		fireAngle = (Math.atan2(hitPosition[1], hitPosition[0]) + 2*Math.PI) % (2*Math.PI);
		return fireAngle;
	    }
	}
    }
}

if (typeof(module) !== 'undefined') {
    module.exports = turretWeapon;
}
