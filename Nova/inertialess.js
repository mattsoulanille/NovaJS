/*
inertialess.js
Handles any space object that moves without inertia



*/


function inertialess(name) {
    object.call(this, name)
	this.velocity = [0,0]
	this.polarVelocity = 0
}

inertialess.prototype = new object


inertialess.prototype.updateStats = function(turning, accelerating) {
    
    inertialess.prototype.render.call(this, turning, accelerating)

}


inertialess.prototype.render = function(turning, accelerating) {
    if (this.renderReady == true) {
	//	console.log(accelerating)
	var angle = this.pointing;
	var accelDir = 0
	this.velocity = [Math.cos(angle) * this.polarVelocity, Math.sin(angle) * this.polarVelocity]
	if (accelerating == -1) {
	    if (this.polarVelocity > 0) {
		accelDir += -1
	    }
	    else if (this.polarVelocity < 0) {
		this.polarVelocity = 0
		accelDir = 0
	    }
	}


	//acceleration
	if (accelerating == 1) {
	    if (typeof this.lastTime != 'undefined') {
		//var aCoefficient = (this.meta.physics.max_speed - Math.pow(Math.pow(this.velocity[0], 2) + Math.pow(this.velocity[1], 2), .5)) / this.meta.physics.max_speed
		accelDir += 1
		if (this.polarVelocity > this.meta.physics.max_speed) {
		    this.polarVelocity = this.meta.physics.max_speed
      		    accelDir = 0
		}
	    }
	}
//	this.previousAccelTime = this.time
	
	if (typeof this.lastTime != 'undefined') {
	    this.position[0] += this.velocity[0] * (this.time - this.lastTime)/1000
	    this.position[1] += this.velocity[1] * (this.time - this.lastTime)/1000
	    this.polarVelocity += this.meta.physics.acceleration * accelDir * (this.time - this.lastTime)/1000
	}

//	this.previousMoveTime = this.time
	object.prototype.render.call(this, turning)
	return true
    }
    else {
	return false
    }

}
