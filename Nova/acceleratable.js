function acceleratable(name) {
    turnable.call(this, name)
    this.lastAccelerating = false;
    this.accelerating = false;
}


acceleratable.prototype = new turnable;

acceleratable.prototype.updateStats = function(turning, accelerating) {
    turnable.prototype.updateStats.call(this, turning);
    this.accelerating = accelerating;
}
acceleratable.prototype.setProperties = function() {

    turnable.prototype.setProperties.call(this);
    this.properties.acceleration = this.meta.physics.acceleration;
    this.properties.maxSpeed = this.meta.physics.max_speed;
    this.properties.inertialess = this.meta.physics.inertialess;
}

acceleratable.prototype.render = function() {

    if (this.renderReady === true) {

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

	turnable.prototype.render.call(this)
    }
}
