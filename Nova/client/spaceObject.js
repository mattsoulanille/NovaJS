if (typeof(module) !== 'undefined') {
    module.exports = spaceObject;
    var sprite = require("../server/spriteServer.js")
    var PIXI = require("../server/pixistub.js");
    var _ = require("underscore");
    var Promise = require("bluebird");

}


function spaceObject(buildInfo, system) {
    this.buildInfo = buildInfo
    this.system = system;
    this.renderReady = false;
    this.rendering = false; // whether or not to render
    this.url = 'objects/misc/';
    this.position = [0,0];
    // planets can have weapons
    // this also means projectiles can have weapons :P
    this.weapons = {};
    this.weapons.all = [];

    this.sprites = {};
    this.spriteContainer = new PIXI.Container();
    this.spriteContainer.visible = false;
    this.size = [];
    this.visible;
    this.built = false;

    if (typeof(buildInfo) !== 'undefined') {
	this.name = buildInfo.name;
	this.buildInfo.type = 'spaceObject';
	this.buildInfo.UUID = buildInfo.UUID;
	if (typeof this.buildInfo.UUID !== 'undefined') {
	    this.buildInfo.multiplayer = true;
	    this.UUID = this.buildInfo.UUID;
	}

	if (this.buildInfo.multiplayer) {
	    this.system.multiplayer[this.buildInfo.UUID] = this;
	}
    }
    if (typeof(system) !== 'undefined') {
	this.system.spaceObjects.push(this)
    }
}

spaceObject.prototype.build = function() {


    return this.loadResources()
    	.then(_.bind(this.setProperties, this))
	.then(_.bind(this.makeSprites, this))
	.then(_.bind(this.makeSize, this))
	.then(_.bind(this.addSpritesToContainer, this))
	.then(_.bind(this.addToSpaceObjects, this))
	.then(function() {this.built = true;}.bind(this));

    
};
spaceObject.prototype.addToSpaceObjects = function() {
    this.system.built.spaceObjects.push(this);
    if (this.buildInfo.multiplayer) {
	this.system.built.multiplayer[this.buildInfo.UUID] = this;
    }

}

spaceObject.prototype.loadResources = function() {
    return new Promise(function(fulfill, reject) {
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

    return Promise.all(  _.map(_.values(this.sprites), function(s) {return s.build()})  )
	.then(function() {
	    this.renderReady = true;
	}.bind(this));

}

spaceObject.prototype.makeSize = function() {

    var textures = _.map(this.sprites, function(s) {return s.textures});

    this.size[0] = Math.max.apply(null, _.map(textures, function(textureList) {
	return Math.max.apply(null, _.map(textureList, function(texture) {return texture.width}));
    }));

    this.size[1] = Math.max.apply(null, _.map(textures, function(textureList) {
	return Math.max.apply(null, _.map(textureList, function(texture) {return texture.height}));
    }));


}


//write this method in the ships funcitons to add engines and lights in the right order
spaceObject.prototype.addSpritesToContainer = function() {
    _.each(_.map(_.values(this.sprites), function(s) {return s.sprite;}),
	   function(s) {
	       this.spriteContainer.addChild(s);
	   }, this);
    this.hide()
    stage.addChild(this.spriteContainer);
    

}


spaceObject.prototype.callSprites = function(toCall) {
    return _.map(_.map(_.values(this.sprites), function(x) {return x.sprite;}), toCall, this);
}

spaceObject.prototype.hide = function() {
    this.spriteContainer.visible = false;
    this.visible = false;
    this.rendering = false;
}

spaceObject.prototype.show = function() {
    if (this.built) {
	this.spriteContainer.visible = true;
	this.visible = true;
	this.rendering = true;
	return true;
    }
    else {
	return false;
    }
}

spaceObject.prototype.updateStats = function(stats) {
    if (typeof(stats.position) !== 'undefined') {
	this.position[0] = stats.position[0];
	this.position[1] = stats.position[1];
    }
    if (typeof(stats.visible) !== 'undefined') {
	if (stats.visible && !this.visible) {
	    this.show();
	}
	else if (!stats.visible && this.visible) {
	    this.hide();
	}
    }
    if (typeof(stats.lastTime) !== 'undefined') {
	this.lastTime = stats.lastTime;
    }
    
}

spaceObject.prototype.getStats = function() {
    var stats = {};
    stats.position = [this.position[0], this.position[1]];
    stats.visible = this.visible;
//    stats.lastTime = this.lastTime;
//    stats.target = this.target;
    return stats;
}



spaceObject.prototype.render = function() {
    if (this.renderReady == true) {

	if (!this.isPlayerShip) {
	    // -194 for the sidebar
	    this.spriteContainer.position.x = positionConstant *
		(this.position[0] - stagePosition[0]) + (screenW-194)/2;
	    this.spriteContainer.position.y = -1 * positionConstant *
		(this.position[1] - stagePosition[1]) + screenH/2;

	}
	
	return true;
    }
    else {
	return false; // oh no. I'm not ready to render. better not try
    }
}

// destroys the object. This is NOT the function to call
// if you want it to explode.
spaceObject.prototype.destroy = function() {


    var index = this.system.spaceObjects.indexOf(this);
    if (index !== -1) {
	this.system.spaceObjects.splice(index, 1);
    }
    
    if (this.built) {
	var index = this.system.built.spaceObjects.indexOf(this);
	if (index !== -1) {
	    this.system.built.spaceObjects.splice(index, 1);
	}
    }
    this.hide();
    this.spriteContainer.destroy();
    _.each(this.sprites, function(s) {s.sprite.destroy()});
//    delete this;
}
