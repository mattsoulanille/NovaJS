function turnable(name) {
    damageable.call(this, name);
    this.turning = "";

}

turnable.prototype = new damageable;

turnable.prototype.setProperties = function() {

    damageable.prototype.setProperties.call(this)

    // 10 nova spaceObject turn rate/sec ~= 30°/sec This turn rate is radians/sec
    this.properties.turnRate = this.meta.physics.turn_rate * 2*Math.PI/120 || 0;

}

turnable.prototype.updateStats = function(turning) {

    this.turning = turning;
}

turnable.prototype.turnTo = function(pointTo) {
    // Sets this.turning to turn the object to a given direction

    if (pointTo < 0 || pointTo >= 2*Math.PI) {
	console.log("turnTo called with invalid angle");
    }
    
    var pointDiff = (pointTo - this.pointing + 2*Math.PI) % (2*Math.PI)
    var turning;
    if (pointDiff < Math.PI) {
	turning = "left"
    }
    else if(pointDiff >= Math.PI) {
	turning = "right"
    }

    if ((this.pointing == pointTo) || (Math.min(Math.abs(Math.abs(this.pointing - pointTo) - 2*Math.PI),
		  Math.abs(this.pointing - pointTo)) < (this.properties.turnRate * (this.time - this.lastTime) / 1000))) {
	this.pointing = pointTo
	this.turning = ""
    }
    else {
	this.turning = turning
    }

}

turnable.prototype.build = function() {
    return damageable.prototype.build.call(this)
	.then(function() {
	    this.hasLeftTexture = _.every(this.sprites, function(s) {
		if (s.spriteImageInfo.meta.imagePurposes.left) {
		    return true;
		}
		else {
		    return false;
		}
	    });

	    
	    this.hasRightTexture = _.every(this.sprites, function(s) {
		if (s.spriteImageInfo.meta.imagePurposes.right) {
		    return true;
		}
		else {
		    return false;
		}
	    });
	}.bind(this));


}



turnable.prototype.render = function() {
    // this stuff is a mess...
    if (this.renderReady === true) {

	

    	var frameStart = _.map(this.sprites, function(s) {return s.spriteImageInfo.meta.imagePurposes.normal.start;});
	var frameCount = _.map(this.sprites, function(s) {return s.spriteImageInfo.meta.imagePurposes.normal.length;});

	// if the new direction does not equal the previous direction
	if ((typeof this.lastTurning == 'undefined') || (this.turning != this.lastTurning) || this.turnback != this.lastTurnBack) { 
	    this.turnStartTime = this.time; // the turn started at the average of the times
	    this.origionalPointing = this.pointing;
	    this.lastTurnBack = this.turnback;

	}
	if (this.turning == "left") {
	    this.pointing = this.origionalPointing + (this.properties.turnRate * (this.time - this.turnStartTime) / 1000);

	    if (this.hasLeftTexture) {
		frameStart = _.map(this.sprites, function(s){ return s.spriteImageInfo.meta.imagePurposes.left.start; });
		frameCount = _.map(this.sprites, function(s){ return s.spriteImageInfo.meta.imagePurposes.left.length; });
	    }
	}
	else if (this.turning == "right") {
	    this.pointing = this.origionalPointing - (this.properties.turnRate * (this.time - this.turnStartTime) / 1000);

	    if (this.hasRightTexture) {
		frameStart = _.map(this.sprites, function(s){ return s.spriteImageInfo.meta.imagePurposes.right.start; });
		frameCount = _.map(this.sprites, function(s){ return s.spriteImageInfo.meta.imagePurposes.right.length; });
	    }
	}



	this.pointing = this.pointing % (2*Math.PI);  //makes sure turnable.pointing is in the range [0, 2pi)
	if (this.pointing < 0) {
	    this.pointing += 2*Math.PI;
	}

	var useThisImage = [];
	for (var i = 0; i < _.keys(this.sprites).length; i++) {
	    // turnable uses image 0 for [this.pointing - pi/frameCount, this.pointing + pi/frameCount) etc
	    var spr = _.values(this.sprites);
	    useThisImage[i] = Math.floor((2.5*Math.PI - this.pointing)%(2*Math.PI) * frameCount[i] / (2*Math.PI)) + frameStart[i];
	    //console.log(useThisImage)
	    spr[i].sprite.rotation = (-1*this.pointing) % (2*Math.PI/frameCount[i]) + (Math.PI/frameCount[i]);  // how much to rotate the image

	    spr[i].sprite.texture = spr[i].textures[useThisImage[i]];
	}

	// this.origionalPointing is the angle the turnable was pointed towards before it was told a different direction to turn.
	this.lastTurning = this.turning; // last turning value: left, right, or back


	damageable.prototype.render.call(this);
	return true;
    }
    else {
	return false;
    }
}
