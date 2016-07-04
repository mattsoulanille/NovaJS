function spaceObject(objectName) {
    this.name = objectName || "";
    this.renderReady = false;
    this.lastAccelerating = false;
    this.url = 'objects/';
    this.position = [0,0];
}

spaceObject.prototype.build = function() {
    return this.loadResources()
	.then(_.bind(this.makeSprites, this), function() {console.log('rejected loadResources'); console.log(reason)})
	.then(_.bind(this.addSpritesToContainer, this), function(reason) {console.log('rejected makeSprites'); console.log(reason)});

    
};


spaceObject.prototype.loadResources = function() {
    return new RSVP.Promise(function(fulfill, reject) {
	//console.log(this);
	var jsonUrl = this.url + this.name + '.json';
	var loader = new PIXI.loaders.Loader();
	loader
	    .add('meta', jsonUrl)
	    .load(function (loader, resource) {
		this.meta = resource.meta.data;
		
	    }.bind(this)) // for loader.load
	    .once('complete', function() {

		if ((typeof(this.meta) !== 'undefined') && (this.meta !== null)) {
		    //console.log('fulfilling');
		    fulfill();

		}
		else {
		    reject();
		}

	    }.bind(this)); // for loader.once('complete'...

    }.bind(this)); // for the promise
};

/*
spaceObject.prototype.build = function() {
    var jsonUrl = this.url + this.name + '.json';
    var loader = new PIXI.loaders.Loader();
    
    loader
	.add('meta', jsonUrl)
	.load(function (loader, resource) {
	    this.meta = resource.meta.data;

	}.bind(this));

};
*/
spaceObject.prototype.makeSprites = function() {
    return new RSVP.Promise(function(fulfill, reject) {
	//    console.log("making sprites");
	//    console.log(this);
	//if (typeof(this.meta.physics.turn_rate) !== "undefined") {
	this.turnRate = this.meta.physics.turn_rate * 2*Math.PI/120 || 0; // 10 nova spaceObject turn rate/sec ~= 30°/sec This turn rate is radians/sec
	//}
	//console.log(this.meta);
	this.sprites = {};
	this.spriteContainer = new PIXI.Container();

	_.each(_.keys(this.meta.imageAssetsFiles), function(key) {
	    if (this.meta.imageAssetsFiles.hasOwnProperty(key)) {
		this.sprites[key] = new sprite(this.url + this.meta.imageAssetsFiles[key]);
	    }
	}, this);
	this.loadedSprites = 0;

	//console.log(this);

	var spriteLoadedCallback = function(that) {
	    return function() {
		that.loadedSprites ++;
    //	    console.log(that)
		if (that.loadedSprites == _.keys(that.sprites).length) {
		    that.renderReady = true;
		    fulfill()
		}
	    };
	};

	_.each(_.values(this.sprites), function(s) {s.build(spriteLoadedCallback(this));}, this);
    }.bind(this)); // matches Promise
}

//write this method in the ships funcitons to add engines and lights in the right order
spaceObject.prototype.addSpritesToContainer = function() {
    _.each(_.map(_.values(this.sprites), function(s) {return s.sprite;}),
	   function(s) {this.spriteContainer.addChild(s);}, this);
    stage.addChild(this.spriteContainer);


}



spaceObject.prototype.updateStats = function(turning) {
    this.turning = turning
    //spaceObject.prototype.render.call(this); 
}


spaceObject.prototype.callSprites = function(toCall) {
    _.each(_.map(_.values(this.sprites), function(x) {return x.sprite;}), toCall, this);
}

spaceObject.prototype.hide = function() {
    this.callSprites(function(s) {s.visible = false})
}

spaceObject.prototype.show = function() {
    this.callSprites(function(s) {s.visible = true})
}

/*
  The spaceObject render function handles the turning and rendering of space objects. TODO: instead of having this handle one pixi object, make it handle the ship, the running lights, and the thrusters. It can have a list to store the pixi objects in and iterate over that list? 

*/


spaceObject.prototype.turning = "";
spaceObject.prototype.autoRender = false

spaceObject.prototype.doAutoRender = function() {
    if (this.autoRender) {
	this.render();
	setTimeout(_.bind(this.doAutoRender, this), 0);
    }
}


spaceObject.prototype.startRender = function() {
    if (this.renderReady) {
	this.autoRender = true
	this.doAutoRender()
    }
}

spaceObject.prototype.stopRender = function() {
    this.autoRender = false;
}

spaceObject.prototype.turnTo = function(pointTo) {
    // Sets this.turning to turn the object to a given direction

    var pointDiff = (pointTo - this.pointing + 2*Math.PI) % (2*Math.PI)
    var turning
    if (pointDiff < Math.PI) {
	turning = "left"
    }
    else if(pointDiff >= Math.PI) {
	turning = "right"
    }

    if ((this.pointing == pointTo) || (Math.min(Math.abs(Math.abs(this.pointing - pointTo) - 2*Math.PI),
		  Math.abs(this.pointing - pointTo)) < (this.turnRate * (this.time - this.lastTime) / 1000))) {
	this.pointing = pointTo
	this.turning = ""
    }
    else {
	this.turning = turning
    }

}

spaceObject.prototype.render = function() {
    if (this.renderReady == true) {
	var frameStart = _.map(this.sprites, function(s) {return s.spriteImageInfo.meta.imagePurposes.normal.start;});
	var frameCount = _.map(this.sprites, function(s) {return s.spriteImageInfo.meta.imagePurposes.normal.length;});
	//this.callSprites(function(a,b,c) {console.log(a)})

	//var frameStart = this.spaceObjectImageInfo.meta.imagePurposes.normal.start
	//var frameCount = this.spaceObjectImageInfo.meta.imagePurposes.normal.length
	if (this.isPlayerShip == true) {
	    //this.callSprites(function(s,b,c) {s.position.x = screenW/2})
	    //this.callSprites(function(s,b,c) {s.position.y = screenH/2})
	    this.spriteContainer.position.x = screenW/2;
	    this.spriteContainer.position.y = screenH/2;
	}
	else {
	    //this.callSprites(function(s,b,c) {s.position.x = positionConstant * (this.position[0] - stagePosition[0]) + screenW/2})
	    //this.callSprites(function(s,b,c) {s.position.y = -1 * positionConstant * (this.position[1] - stagePosition[1]) + screenH/2})
	    this.spriteContainer.position.x = positionConstant * (this.position[0] - stagePosition[0]) + screenW/2;
	    this.spriteContainer.position.y = -1 * positionConstant * (this.position[1] - stagePosition[1]) + screenH/2;
	}
	
	// if the new direction does not equal the previous direction
	if ((typeof this.lastTurning == 'undefined') || (this.turning != this.lastTurning) || this.turnback != this.lastTurnBack) { 
	    this.turnStartTime = this.time; // the turn started at the average of the times
	    this.origionalPointing = this.pointing;
	    this.lastTurnBack = this.turnback;

	}
	if (this.turning == "left") {
	    this.pointing = this.origionalPointing + (this.turnRate * (this.time - this.turnStartTime) / 1000);
	    frameStart = _.map(this.sprites, function(s){ return s.spriteImageInfo.meta.imagePurposes.left.start; });
	    frameCount = _.map(this.sprites, function(s){ return s.spriteImageInfo.meta.imagePurposes.left.length; });
	}
	else if (this.turning == "right") {
	    this.pointing = this.origionalPointing - (this.turnRate * (this.time - this.turnStartTime) / 1000);

	    frameStart = _.map(this.sprites, function(s){ return s.spriteImageInfo.meta.imagePurposes.right.start; });
	    frameCount = _.map(this.sprites, function(s){ return s.spriteImageInfo.meta.imagePurposes.right.length; });
	}

	else {
	    frameStart = _.map(this.sprites, function(s){ return s.spriteImageInfo.meta.imagePurposes.normal.start; });
	    frameCount = _.map(this.sprites, function(s){ return s.spriteImageInfo.meta.imagePurposes.normal.length; });
	}


	this.pointing = this.pointing % (2*Math.PI);  //makes sure spaceObject.pointing is in the range [0, 2pi)
	if (this.pointing < 0) {
	    this.pointing += 2*Math.PI;
	}

	var useThisImage = [];
	for (var i = 0; i < _.keys(this.sprites).length; i++) {
	    // spaceObject uses image 0 for [this.pointing - pi/frameCount, this.pointing + pi/frameCount) etc
	    var spr = _.values(this.sprites);
	    useThisImage[i] = Math.floor((2.5*Math.PI - this.pointing)%(2*Math.PI) * frameCount[i] / (2*Math.PI)) + frameStart[i];
	    //console.log(useThisImage)
	    spr[i].sprite.rotation = (-1*this.pointing) % (2*Math.PI/frameCount[i]) + (Math.PI/frameCount[i]);  // how much to rotate the image

	    spr[i].sprite.texture = spr[i].textures[useThisImage[i]];
	}

	// this.origionalPointing is the angle the spaceObject was pointed towards before it was told a different direction to turn.
	this.lastTurning = this.turning; // last turning value: left, right, or back

	this.lastTime = this.time;
	return true;
    }
    else {
	return false; // oh no. I'm not ready to render. better not try
    }
}

