/*
movable.js
Handles any space object that moves



*/


function movable(name) {
    spaceObject.call(this, name);
    this.velocity = [0,0];
}

movable.prototype = new spaceObject;
movable.prototype.accelerating = false;



movable.prototype.updateStats = function(turning, accelerating) {
    
    this.turning = turning;
    this.accelerating = accelerating;
    //movable.prototype.render.call(this);
    

}

movable.prototype.setProperties = function() {
    // seems a bit insane: inserts a promise into the
    // spaceObject.prototype.loadResources promise chain
    return spaceObject.prototype.setProperties.call(this)
	.then(_.bind(function() {
	    return new RSVP.Promise(function(fulfill, reject) {
		this.properties.maxSpeed = this.meta.physics.max_speed;
		this.properties.acceleration = this.meta.physics.acceleration;
		this.properties.inertialess = this.meta.physics.inertialess;
		fulfill();
	    }.bind(this));
	}, this));

}

movable.prototype.render = function() {
    if (this.renderReady == true) {
	
	this.turnback = false
	if (!this.properties.inertialess) {
	    if (this.accelerating == -1) {
		var vAngle = Math.atan(this.velocity[1] / this.velocity[0])
		if (this.velocity[0] < 0) {
		    vAngle = vAngle + Math.PI
		}
		pointto = (vAngle + Math.PI) % (2*Math.PI);
		this.turnTo(pointto);
	    }


	    //acceleration
	    var xaccel = Math.cos(this.pointing) * this.properties.acceleration
	    var yaccel = Math.sin(this.pointing) * this.properties.acceleration
	    if (this.accelerating == true) {
		if (typeof this.lastTime != 'undefined') {
		    //var aCoefficient = (this.properties.maxSpeed - Math.pow(Math.pow(this.velocity[0], 2) + Math.pow(this.velocity[1], 2), .5)) / this.properties.maxSpeed
		    this.velocity[0] += xaccel * (this.time - this.lastTime)/1000
		    this.velocity[1] += yaccel * (this.time - this.lastTime)/1000

		    // keep velocity under max speed
		    var speed = Math.pow(Math.pow(this.velocity[0], 2) + Math.pow(this.velocity[1], 2), .5);
		    if (speed > this.properties.maxSpeed) {
			var tmpAngle = Math.atan(this.velocity[1] / this.velocity[0])
			if (this.velocity[0] < 0) {
			    tmpAngle = tmpAngle + Math.PI
			}
			//console.log(tmpAngle)
			this.velocity[0] = Math.cos(tmpAngle) * this.properties.maxSpeed
			this.velocity[1] = Math.sin(tmpAngle) * this.properties.maxSpeed
		    }
		}
	    }
	}
	else { // if it is inertialess
	    if (typeof this.polarVelocity == 'undefined') {
		this.polarVelocity = 0
	    }

	    var angle = this.pointing;
	    var accelDir = 0
	    this.velocity = [Math.cos(angle) * this.polarVelocity, Math.sin(angle) * this.polarVelocity]
	    if (this.accelerating == -1) {
		if (this.polarVelocity > 0) {
		    accelDir += -1
		}
		else if (this.polarVelocity < 0) {
		    this.polarVelocity = 0
		    accelDir = 0
		}
	    }

	    if (this.accelerating == 1) {
		if (typeof this.lastTime != 'undefined') {

		    accelDir += 1
		    if (this.polarVelocity > this.properties.maxSpeed) {
			this.polarVelocity = this.properties.maxSpeed
      			accelDir = 0
		    }
		}
	    }
	    if (typeof this.lastTime != 'undefined') {
		this.polarVelocity += this.properties.acceleration * accelDir * (this.time - this.lastTime)/1000
	    }
	}

	if (typeof this.lastTime != 'undefined') {
	    this.position[0] += this.velocity[0] * (this.time - this.lastTime)/1000
	    this.position[1] += this.velocity[1] * (this.time - this.lastTime)/1000
	    
	}

//	this.previousMoveTime = this.time
	spaceObject.prototype.render.call(this)
	return true
    }
    else {
	return false
    }

}
