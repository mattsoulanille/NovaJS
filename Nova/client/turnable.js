if (typeof(module) !== 'undefined') {
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
	super.setProperties.call(this);
	// 10 nova spaceObject turn rate/sec ~= 30°/sec This turn rate is radians/sec
	this.properties.turnRate = this.meta.turnRate * 2*Math.PI/120 || 0;
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
	//console.log(stats);
	return stats;
    }

    turnTo(pointTo) {
	// Sets this.turning to turn the object to a given direction
	
	if (pointTo < 0 || pointTo >= 2*Math.PI) {
	    console.log("turnTo called with invalid angle");
	}
	
	var pointDiff = (pointTo - this.pointing + 2*Math.PI) % (2*Math.PI);
	var turning;

	if (this.delta !== 0) {
	    if ((this.pointing == pointTo) || (Math.min(Math.abs(Math.abs(this.pointing - pointTo) - 2*Math.PI),
							Math.abs(this.pointing - pointTo)) <= (this.properties.turnRate * (this.delta) / 1000))) {
		this.pointing = pointTo;
		this.turning = "";
	    }

	    else if (pointDiff < Math.PI) {
		this.turning = "left";
	    }
	    else if(pointDiff >= Math.PI) {
		this.turning = "right";
	    }

	}
    }
    
    async _build() {
	await super._build();

	// default imagePurposes to all for normal if none is given
	Object.keys(this.meta.animation.images).forEach(function(imageName) {
	    var image = this.meta.animation.images[imageName];
	    if (typeof image.imagePurposes === 'undefined') {
		image.imagePurposes = {
		    normal: {
			start:0,
			length: this.sprites[imageName].convexHulls.length
			// hacky. server needs this too, and server only has convexHulls
			// very hacky. Fix me somehow
		    }
		};
	    }
	}.bind(this));
	
	this.hasLeftTexture = _.every(this.meta.animation.images, function(image) {
	    if (image.imagePurposes.left) {
		return true;
	    }
	    else {
		return false;
	    }
	});

	this.hasRightTexture = _.every(this.meta.animation.images, function(image) {
	    if (image.imagePurposes.right) {
		return true;
	    }
	    else {
		return false;
	    }
	});
    }

    renderSprite(spr, rotation, imageIndex) {
	spr.sprite.rotation = rotation;
	spr.sprite.texture = spr.textures[imageIndex];
	
    }
    
    render() {
	if (this.renderReady === true) {
	    var images = this.meta.animation.images;

	    var frameStart = _.map(images, function(image) {return image.imagePurposes.normal.start;});
	    var frameCount = _.map(images, function(image) {return image.imagePurposes.normal.length;});
	    // continue here
	    
	    if (this.turning == "left") {
		
		this.pointing = this.pointing + (this.properties.turnRate * (this.time - this.lastTime) / 1000);
		//console.log(this.time - this.lastTime);
		if (this.hasLeftTexture) {
		    frameStart = _.map(images, function(image) {return image.imagePurposes.left.start;});
		    frameCount = _.map(images, function(image) {return image.imagePurposes.left.length;});		    
		}
	    }
	    else if (this.turning == "right") {

		this.pointing = this.pointing - (this.properties.turnRate * (this.time - this.lastTime) / 1000);
		// Right != correct in this instance. Right = a direction.
		if (this.hasRightTexture) {
		    frameStart = _.map(images, function(image) {return image.imagePurposes.right.start;});
		    frameCount = _.map(images, function(image) {return image.imagePurposes.right.length;});
		}
	    }

	    // makes sure turnable.pointing is in the range [0, 2pi)
	    this.pointing = (this.pointing + 2*Math.PI) % (2*Math.PI);  

	    var keys = _.keys(this.sprites);
	    for (var i = 0; i < _.keys(this.sprites).length; i++) {
		// turnable uses image 0 for [this.pointing - pi/frameCount, this.pointing + pi/frameCount) etc
		
		var spr = this.sprites[keys[i]];
		var imageIndex = Math.floor((2.5*Math.PI - this.pointing)%(2*Math.PI) * frameCount[i] / (2*Math.PI)) + frameStart[i];
		//console.log(imageIndex)
		var rotation = (-1*this.pointing) % (2*Math.PI/frameCount[i]) + (Math.PI/frameCount[i]);  // how much to rotate the image
		
		this.renderSprite(spr, rotation, imageIndex);

		if (keys[i] === this.collisionSpriteName) {
		    var newShape = this.collisionShapes[imageIndex];
		    
		    if (this.collisionShape !== newShape) {
			//		    console.log("inserting new collision shape");
			this.collisionShape.remove();
			if (! (_.contains(this.crash.all(), newShape)) ) {
			    newShape.insert();
			}
			this.collisionShape = newShape;
		    }
		    
		    this.collisionShape.setAngle(rotation);
		}
	    }
	    // this.origionalPointing is the angle the turnable was pointed towards before it was told a different direction to turn.
	    
	    return super.render.call(this);
	}
	else {
	    return false;
	}
    }

}
    
if (typeof(module) !== 'undefined') {
    module.exports = turnable;
}
