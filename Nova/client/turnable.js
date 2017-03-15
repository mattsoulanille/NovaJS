if (typeof(module) !== 'undefined') {
    var damageable = require("../server/damageableServer.js");
    var _ = require("underscore");
    var Promise = require("bluebird");
}


var turnable = (superclass) => class extends superclass {

    constructor() {
	super(...arguments);
	this.turning = "";
	if (typeof(buildInfo) !== 'undefined') {
	    this.buildInfo.type = "turnable";
	}
    }

    setProperties() {
	super.setProperties.call(this)
	// 10 nova spaceObject turn rate/sec ~= 30°/sec This turn rate is radians/sec
	this.properties.turnRate = this.meta.physics.turn_rate * 2*Math.PI/120 || 0;
    }
    
    updateStats(stats) {
	super.updateStats.call(this, stats);
	if (typeof(stats.turning) !== 'undefined') {
	    this.turning = stats.turning;
	}
	if (typeof(stats.pointing) !== 'undefined') {
	    this.pointing = stats.pointing;
	}
    }

    getStats() {
	var stats = super.getStats.call(this);
	stats.turning = this.turning;
	stats.pointing = this.pointing;
	return stats;
    }

    turnTo(pointTo) {
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
    
    build() {
	return super.build.call(this)
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

    render() {

	// this stuff is a mess...
	if (this.renderReady === true) {
	    
    	    var frameStart = _.map(this.sprites, function(s) {return s.spriteImageInfo.meta.imagePurposes.normal.start;});
	    var frameCount = _.map(this.sprites, function(s) {return s.spriteImageInfo.meta.imagePurposes.normal.length;});
	    
	    if (this.turning == "left") {
		this.pointing = this.pointing + (this.properties.turnRate * (this.time - this.lastTime) / 1000);
		
		if (this.hasLeftTexture) {
		    frameStart = _.map(this.sprites, function(s){ return s.spriteImageInfo.meta.imagePurposes.left.start; });
		    frameCount = _.map(this.sprites, function(s){ return s.spriteImageInfo.meta.imagePurposes.left.length; });
		}
	    }
	    else if (this.turning == "right") {
		this.pointing = this.pointing - (this.properties.turnRate * (this.time - this.lastTime) / 1000);
		
		// Right != correct in this instance. Right = a direction.
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
	    var keys = _.keys(this.sprites);
	    for (var i = 0; i < _.keys(this.sprites).length; i++) {
		// turnable uses image 0 for [this.pointing - pi/frameCount, this.pointing + pi/frameCount) etc
		
		var spr = this.sprites[keys[i]]
		useThisImage[i] = Math.floor((2.5*Math.PI - this.pointing)%(2*Math.PI) * frameCount[i] / (2*Math.PI)) + frameStart[i];
		//console.log(useThisImage)
		spr.sprite.rotation = (-1*this.pointing) % (2*Math.PI/frameCount[i]) + (Math.PI/frameCount[i]);  // how much to rotate the image
		
		spr.sprite.texture = spr.textures[useThisImage[i]];
		
		if (keys[i] === this.collisionSpriteName) {
		    var newShape = this.collisionShapes[useThisImage[i]];
		    
		    if (this.collisionShape !== newShape) {
			//		    console.log("inserting new collision shape");
			this.collisionShape.remove();
			if (! (_.contains(this.crash.all(), newShape)) ) {
			    newShape.insert();
			}
			this.collisionShape = newShape;
		    }
		    
		    this.collisionShape.setAngle(spr.sprite.rotation);
		}
	    }
	    
	    // this.origionalPointing is the angle the turnable was pointed towards before it was told a different direction to turn.
	    
	    
	    
	    super.render.call(this);
	    return true;
	}
	else {
	    return false;
	}
    }

}
    
if (typeof(module) !== 'undefined') {
    module.exports = turnable;
}
