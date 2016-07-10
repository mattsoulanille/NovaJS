function spaceObject(objectName) {
    this.name = objectName || "";
    this.renderReady = false;
    this.url = 'objects/misc/';
    this.position = [0,0];
    // planets can have weapons
    // this also means projectiles can have weapons :P
    this.weapons = {};
    this.weapons.all = [];
    this.autoRender = false
    this.sprites = {};
    this.spriteContainer = new PIXI.Container();


}

spaceObject.prototype.build = function() {
    return this.loadResources()
    	.then(_.bind(this.setProperties, this))
	.then(_.bind(this.makeSprites, this))
	.then(_.bind(this.addSpritesToContainer, this))
        .catch(function(reason) {console.log(reason)});
    
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


spaceObject.prototype.setProperties = function() {
    this.properties =  {};
    if (this.meta.properties) {
	_.each(this.meta.properties, function(value, key) {
	    this.properties[key] = value;
	}, this);
    }
    

}
spaceObject.prototype.makeSprites = function() {
    //    console.log("making sprites");
    //    console.log(this);
    //console.log(this.meta);


    _.each(_.keys(this.meta.imageAssetsFiles), function(key) {
	if (this.meta.imageAssetsFiles.hasOwnProperty(key)) {
	    this.sprites[key] = new sprite(this.url + this.meta.imageAssetsFiles[key]);
	}
    }, this);

    return RSVP.all(  _.map(_.values(this.sprites), function(s) {return s.build()})  )
	.then(function() {
	    this.renderReady = true;
	}.bind(this));

}

//write this method in the ships funcitons to add engines and lights in the right order
spaceObject.prototype.addSpritesToContainer = function() {
    _.each(_.map(_.values(this.sprites), function(s) {return s.sprite;}),
	   function(s) {this.spriteContainer.addChild(s);}, this);
    this.hide()
    stage.addChild(this.spriteContainer);
    

}



//spaceObject.prototype.updateStats = function(turning) {

    ////spaceObject.prototype.render.call(this); 
//}


spaceObject.prototype.callSprites = function(toCall) {
    _.each(_.map(_.values(this.sprites), function(x) {return x.sprite;}), toCall, this);
}

spaceObject.prototype.hide = function() {
    this.callSprites(function(s) {s.visible = false});
    this.visible = false;
    this.stopRender();
}

spaceObject.prototype.show = function() {
    this.callSprites(function(s) {s.visible = true});
    this.visible = true;
    if (! this.autoRender) {
	this.startRender();
    }
}

/*
  The spaceObject render function handles the turning and rendering of space objects. TODO: instead of having this handle one pixi object, make it handle the ship, the running lights, and the thrusters. It can have a list to store the pixi objects in and iterate over that list? 

*/



spaceObject.prototype.doAutoRender = function() {
    if (this.autoRender) {
	this.render();
	setTimeout(_.bind(this.doAutoRender, this), 0);
    }
}


spaceObject.prototype.startRender = function() {
    if (this.renderReady && !this.autoRender) {
	this.autoRender = true
	this.doAutoRender()
    }
}

spaceObject.prototype.stopRender = function() {
    this.autoRender = false;
}


spaceObject.prototype.render = function() {
    if (this.renderReady == true) {

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

	
	return true;
    }
    else {
	return false; // oh no. I'm not ready to render. better not try
    }
}

