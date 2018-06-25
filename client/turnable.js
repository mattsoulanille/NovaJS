var _ = require("underscore");
//var Promise = require("bluebird");

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

    // renderSprite(spr, rotation, imageIndex) {
    // 	super.renderSprite(...arguments);
    // }
    
    render(delta) {
	var images = this.meta.animation.images;

	// Maybe preprocess this instead. would be simpler
	var frameStart = _.map(images, function(image) {return image.imagePurposes.normal.start;});
	var frameCount = _.map(images, function(image) {return image.imagePurposes.normal.length;});
	// continue here
	
	if (this.turning == "left") {
	    
	    this.pointing = this.pointing + (this.properties.turnRate * delta / 1000);
	    if (this.hasLeftTexture) {
		frameStart = _.map(images, function(image) {return image.imagePurposes.left.start;});
		frameCount = _.map(images, function(image) {return image.imagePurposes.left.length;});		    
	    }
	}
	else if (this.turning == "right") {
	    
	    this.pointing = this.pointing - (this.properties.turnRate * delta / 1000);
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
	    //var imageIndex = Math.floor((2.5*Math.PI - this.pointing)%(2*Math.PI) * frameCount[i] / (2*Math.PI)) + frameStart[i];
	    var start = frameStart[i];
	    var count = frameCount[i];

	    // Nova files use clock. This uses unit circle
	    var clock = modPI(-this.pointing + Math.PI / 2);

	    // Split the circle up evenly. Each frame gets part to the left and right
	    var halfSplitSize = Math.PI / count;
	    var imageIndex = start + Math.floor(modPI(clock + halfSplitSize) * count / (2*Math.PI));

	    // the 
	    var rotation = clock - (2*Math.PI*(imageIndex / count));

	    //var rotation = (-1*this.pointing) % (2*Math.PI/frameCount[i]) + (Math.PI/frameCount[i]);  // how much to rotate the image
	    
	    this.renderSprite(spr, rotation, imageIndex);
	    
	    if (keys[i] === this.collisionSpriteName) {
		this.renderCollisionSprite(spr, rotation, imageIndex);
	    }
	}
	// this.origionalPointing is the angle the turnable was pointed towards before it was told a different direction to turn.
	
	super.render(...arguments);
    }
    
};

var modPI = function(n) {
    return (n + 2*Math.PI) % (2*Math.PI);
};

module.exports = turnable;

