if (typeof(module) !== 'undefined') {
    var sprite = require("../server/spriteServer.js")
    var PIXI = require("../server/pixistub.js");
    var _ = require("underscore");
    var Promise = require("bluebird");
    var inSystem = require("./inSystem.js")
}


spaceObject = class extends inSystem {

    constructor(buildInfo, system) {
	super(...arguments);
	this.buildInfo = buildInfo;
	this.renderReady = false;
	this.destroyed = false;
    
	// whether or not the object has been
	// rendered yet in this frame. Used for
	// ordering the rendering.
	this.rendered = false;
	
	this.rendering = false; // whether or not to render
	this.url = 'objects/misc/';
	this.position = [0,0];
	// planets can have weapons
	// this also means projectiles can have weapons :P
	this.weapons = {};
	this.weapons.all = [];
	
	this.sprites = {};

	this.size = [];
	this.built = false;

	this.container = new PIXI.Container(); // Must be before call to set system
	this.container.visible = false;




	if (typeof(buildInfo) !== 'undefined') {
	    this.name = buildInfo.name;
	    this.buildInfo.type = 'spaceObject';
	    this.buildInfo.UUID = buildInfo.UUID;
	    if (typeof this.buildInfo.UUID !== 'undefined') {
		this.buildInfo.multiplayer = true;
		this.UUID = this.buildInfo.UUID;
	    }
	    
	//     if (this.buildInfo.multiplayer) {
	// 	this.system.multiplayer[this.buildInfo.UUID] = this;
	//     }
	}
	// if (typeof(system) !== 'undefined') {
	//     this.system.spaceObjects.add(this);
	// }

	this.system = system; // a function call (see inSystem.js)
    }

    async _build() {
	await this.loadResources();
    	await this.setProperties();
	await this.makeSprites();
	this.makeSize();
	this.addSpritesToContainer();
	this.addToSpaceObjects();
    }

    
    async build() {
	this.built = false;
	await this._build();
	this.built = true;
    }
    addToSpaceObjects() {
	this.system.built.spaceObjects.add(this);
	this.system.built.render.add(this);
	if (this.buildInfo.multiplayer) {
	    this.system.built.multiplayer[this.buildInfo.UUID] = this;
	}
    }

    loadResources() {
	return new Promise(function(fulfill, reject) {
	    //console.log(this);
	    var jsonUrl = this.url + this.name + '.json';
	    //console.log(jsonUrl);
	    
	    var loader = new PIXI.loaders.Loader();
	    loader
		.add('meta', jsonUrl)
		.load(function (loader, resource) {
		    this.meta = resource.meta.data;
		    
		}.bind(this)) // for loader.load
	    //.once('complete', function() {
		.onComplete.add(function() {
		    
		    if ((typeof(this.meta) !== 'undefined') && (this.meta !== null)) {
			//console.log('fulfilling');
			fulfill();
			
		    }
		    else {
			reject();
		    }
		    
		}.bind(this)); // for loader.onComplete
	    
	}.bind(this)); // for the promise
    };


    setProperties() {
	this.properties =  {};
	if (this.meta.properties) {
	    _.each(this.meta.properties, function(value, key) {
		this.properties[key] = value;
	    }, this);
	}
    }

    makeSprites() {
	//    console.log("making sprites");
	//    console.log(this);
	//console.log(this.meta);
	
	
	_.each(_.keys(this.meta.imageAssetsFiles), function(key) {
	    this.sprites[key] = new sprite(this.url + this.meta.imageAssetsFiles[key]);
	}, this);
	
	return Promise.all(  _.map(_.values(this.sprites), function(s) {return s.build()})  )
	    .then(function() {
		this.renderReady = true;
	    }.bind(this));
    }



    makeSize() {
	// Is this used for rendering stuff on the screen? I forget. Maybe remove?
	var textures = _.map(this.sprites, function(s) {return s.textures});
	
	this.size[0] = Math.max.apply(null, _.map(textures, function(textureList) {
	    return Math.max.apply(null, _.map(textureList, function(texture) {return texture.width}));
	}));
	
	this.size[1] = Math.max.apply(null, _.map(textures, function(textureList) {
	    return Math.max.apply(null, _.map(textureList, function(texture) {return texture.height}));
	}));
    }


    addSpritesToContainer() {
	_.each(_.map(_.values(this.sprites), function(s) {return s.sprite;}),
	       function(s) {
		   this.container.addChild(s);
	       }, this);
	this.hide();
	this.system.container.addChild(this.container);
    }

    callSprites(toCall) {
	return _.map(_.map(_.values(this.sprites), function(x) {return x.sprite;}), toCall, this);
    }

    hide() {
	this.container.visible = false;
	this.visible = false;
	this.rendering = false;
    }


    show() {
	if (this.built) {
	    this.container.visible = true;
	    this.visible = true;
	    this.rendering = true;
	    
	    return true;
	}
	else {
	    return false;
	}
    }

    updateStats(stats) {
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

    getStats() {
	var stats = {};
	stats.position = [this.position[0], this.position[1]];
	stats.visible = this.visible;
	//    stats.lastTime = this.lastTime;
	//    stats.target = this.target;
	return stats;
    }


    render() {
	if (this.renderReady == true) {
	    
	    if (!this.isPlayerShip) {
		// -194 for the sidebar
		this.container.position.x = 
		    (this.position[0] - stagePosition[0]) + (screenW-194)/2;
		this.container.position.y = -1 *
		    (this.position[1] - stagePosition[1]) + screenH/2;
		
	    }
	    this.rendered = true;
	    return true;
	}
	else {
	    return false; // oh no. I'm not ready to render. better not try
	}
    }


    _removeFromSystem() {
        this.system.container.removeChild(this.container);
	
        if (this.UUID && this.system.multiplayer[this.UUID]) {
            delete this.system.multiplayer[this.UUID];
        }
	
        if (this.built) {
            this.system.built.spaceObjects.delete(this);
            this.system.built.render.delete(this);
        }
        this.system.spaceObjects.delete(this);
    }

    _addToSystem() {
        this.system.container.addChild(this.container);
        if (this.UUID) {
            this.system.multiplayer[this.UUID] = this;
        }

        if (this.built) {
            this.system.built.spaceObjects.add(this);
//            if (this.rendering) {
            this.system.built.render.add(this);

//            }
        }

        this.system.spaceObjects.add(this);
    }
    
// destroys the object. This is NOT the function to call
// if you want it to explode.
    destroy() {
	if (this.destroyed) {
            return;
        }

        this.hide();
        this.system = undefined;

        this.container.destroy();
        _.each(this.sprites, function(s) {s.destroy()});
//	console.log("debug");
        this.destroyed = true;
        //    delete this; 
    }

}

spaceObject.prototype.factor = 3/10; // the factor for nova object movement. Seems to be 3/10

if (typeof(module) !== 'undefined') {
    module.exports = spaceObject;
}

