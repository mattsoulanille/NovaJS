if (typeof(module) !== 'undefined') {
    var sprite = require("../server/spriteServer.js");
    var PIXI = require("../server/pixistub.js");
    var _ = require("underscore");
    var Promise = require("bluebird");
    var inSystem = require("./inSystem.js");
    var loadsResources = require("./loadsResources.js");
    var multiplayer = require("../server/multiplayerServer.js");
}


var spaceObject = class extends loadsResources(inSystem) {

    constructor(buildInfo, system, socket) {

	super(...arguments);
	this.socket = socket || this.socket;
	this.buildInfo = buildInfo;
	this.renderReady = false;
	this.destroyed = false;

	// whether or not the object has been
	// rendered yet in this frame. Used for
	// ordering the rendering.
	this.rendered = false;
	
	this.rendering = false; // whether or not to render
	// is this even used anymore?
	
	this.type = 'misc';
	//this.url = 'objects/misc/';
	this.position = [0,0];
	// planets can have weapons
	// this also means projectiles can have weapons :P
	this.weapons = {};
	this.weapons.all = [];
	
	this.sprites = {};

	this.size = [];
	this.built = false;
	this.building = false;

	this.container = new PIXI.Container(); // Must be before call to set system
	this.container.visible = false;


	if (typeof(buildInfo) !== 'undefined') {
	    this.name = buildInfo.name;
	    if (typeof this.buildInfo.UUID !== 'undefined') {
		this.buildInfo.multiplayer = true;
		this.UUID = this.buildInfo.UUID;
		this.setMultiplayer();
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
    setMultiplayer() {
	// this is due to projectile.js
	// refactor is needed: Multiplayer -> mixin
	// SpaceObject -> default not multiplayer
	// used for multiplayer communication
	this.multiplayer = new multiplayer(this.socket, this.UUID);
    }

    
    setListeners() {
	this.multiplayer.on('updateStats', function(newStats) {
	    this.updateStats(newStats);
	}.bind(this));
    }
    
    get UUIDS() {
	var uuids = [];
	if (this.UUID) {
	    uuids.push(this.UUID);
	}
	return uuids;
    }
    
    async _build() {
	this.meta = await this.loadResources(this.type, this.buildInfo.id);
	this.name = this.meta.name; // purely cosmetic
    	await this.setProperties();
	await this.makeSprites();
	if (this.multiplayer) {
	    this.setListeners();
	}
	this.makeSize();
	this.addSpritesToContainer();
	this.addToSpaceObjects();
	this.renderReady = true;
    }

    async build() {
	if (!this.building && !this.built) {
	    this.building = true;
	    await this._build();
	    this.building = false;
	    this.built = true;
	}	
    }

    sendStats() {
//	var newStats = {};
	//newStats[this.UUID] = this.getStats();
	this.multiplayer.emit("updateStats", this.getStats());
	//this.socket.emit('updateStats', newStats);
    }
    
    addToSpaceObjects() {
	this.system.built.spaceObjects.add(this);
	this.system.built.render.add(this);
	if (this.buildInfo.multiplayer) {
	    this.system.built.multiplayer[this.buildInfo.UUID] = this;
	}
    }

    makeSprites() {

	var images = this.meta.animation.images;
	var promises = Object.keys(images).map(async function(imageName) {
	    var imageID = images[imageName].id;
	    var spriteSheet = await this.novaData.spriteSheets.get(imageID);
	    this.sprites[imageName] = new sprite(spriteSheet.textures, spriteSheet.convexHulls);

	}.bind(this));

	return Promise.all(promises);
    }



    makeSize() {
	// used for targetCorners
	var textures = _.map(this.sprites, function(s) {return s.textures;});
	
	this.size[0] = Math.max.apply(null, _.map(textures, function(textureList) {
	    return Math.max.apply(null, _.map(textureList, function(texture) {return texture.width}));
	}));
	
	this.size[1] = Math.max.apply(null, _.map(textures, function(textureList) {
	    return Math.max.apply(null, _.map(textureList, function(texture) {return texture.height}));
	}));
    }


    addSpritesToContainer() {
	_.each(this.sprites, function(s) {
	    this.container.addChild(s.sprite);
	}.bind(this));
	
	this.hide();

	// Didn't I rewrite the add to system code? Maybe this is unneeded
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
	    // rewrite this please. Put it in playerShip. 
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
	
        if (this.UUID) {
            delete this.system.multiplayer[this.UUID];
	    delete this.system.built.multiplayer[this.UUID];
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
	    if (this.built) {
		this.system.built.multiplayer[this.UUID] = this;
	    }
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
	if (this.multiplayer) {
	    this.multiplayer.destroy();
	}
		
        this.hide();
        this.system = undefined;

        this.container.destroy();
        _.each(this.sprites, function(s) {s.destroy();});
//	console.log("debug");
        this.destroyed = true;
        //    delete this; 
    }

}

spaceObject.prototype.factor = 3/10; // the factor for nova object movement. Seems to be 3/10

if (typeof(module) !== 'undefined') {
    module.exports = spaceObject;
}

