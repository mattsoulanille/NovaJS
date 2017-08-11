if (typeof(module) !== 'undefined') {
    var projectile = require("../server/projectileServer.js");
    var _ = require("underscore");
    var Promise = require("bluebird");

}


guided = class extends projectile {

    constructor() {
	super(...arguments);
    }

    render() {
	if (this.target) {
	    this.turnToTarget();
	}

	super.render.call(this);
    }

    setProperties() {
	this.properties = {inertialess: true};
	super.setProperties.call(this);
    }
    
    turnToTarget() {
	var x_diff = this.target.position[0] - this.position[0];
	var y_diff = this.target.position[1] - this.position[1];
	
	var directionToTarget = (Math.atan2(y_diff, x_diff) + 2*Math.PI) % (2*Math.PI);
	
	this.turnTo(directionToTarget);
	//console.log(directionToTarget);
    }


    fire(direction, position, velocity, target) {
	//var factor = 30/100;
	this.polarVelocity = this.properties.speed * this.factor;
	super.fire.call(this, direction, position, velocity, target);
    }

    end() {
	this.polarVelocity = 0;
	this.turning = "";
	super.end.call(this);
    }
}

if (typeof(module) !== 'undefined') {
    module.exports = guided;
}
