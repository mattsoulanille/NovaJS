
var projectile = require("../server/projectileServer.js");
//var Promise = require("bluebird");


guided = class extends projectile {

    constructor() {
	super(...arguments);
    }

    render() {
	if (this.target) {
	    this.turnToTarget();
	}

	super.render(...arguments);
    }

    setProperties() {
	this.properties.inertialess = true;
	super.setProperties.call(this);
    }

    turnToTarget() {
	var x_diff = this.target.position[0] - this.position[0];
	var y_diff = this.target.position[1] - this.position[1];
	var hitSolution = this.calcHitSolution();
	var turnTo;
	if (hitSolution.fireAngle !== null) {
	    turnTo = hitSolution.fireAngle;
	}
	else {
	    turnTo = (Math.atan2(y_diff, x_diff) + 2*Math.PI) % (2*Math.PI);
	}

	this.turnTo(turnTo);

    }


    fire(direction, position, velocity, target) {
	//var factor = 30/100;
	this.polarVelocity = this.properties.speed * this.factor;
	super.fire(direction, position, velocity, target);
    }

    end() {
	this.polarVelocity = 0;
	this.turning = "";
	super.end(...arguments);
    }

    calcHitSolution() {
	var dx = this.target.position[0] - this.position[0];
	var dy = this.target.position[1] - this.position[1];
	var dvx = this.target.velocity[0] - this.velocity[0];
	var dvy = this.target.velocity[1] - this.velocity[1];
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
		return {fireAngle: fireAngle, hitTime:hitTime};
	    }
	    else {
		return {fireAngle: null, hitTime: null};
	    }
	}
	else {
	    return {fireAngle: null, hitTime: null};
	}
    }

};

module.exports = guided;

