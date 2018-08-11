var renderable = require("./renderable.js");
var inSystem = require("./inSystem.js");
var PIXI = require("pixi.js");
require("pixi-particles");

var particleEmitter = class extends renderable(inSystem) {
    constructor(properties, source) {
	super(...arguments);
	this.factor = 0.5;
	this.source = source;
	this.properties = properties;
	this.container = new PIXI.Container();
	this.built = true;
	//this.hideTimeout = null;
	this._justStopped = false;
	//space.addChild(this.container);

	// To Do: Make a stationary container. Put everything in it.
	
	//this.source.container.addChild(this.container);

	var graphics = new PIXI.Graphics;
	
	graphics.lineStyle(10, 0xFFFFFF);
	graphics.moveTo(0,0);
	graphics.lineTo(10,0);

	var maxLife = 0;
	var minLife = 0;

	if (this.properties.life) {
	    maxLife = minLife = this.properties.life;
	}
	
	if (this.properties.lifeMax) {
	    maxLife = this.properties.lifeMax;
	}
	if (this.properties.lifeMin) {
	    minLife = this.properties.lifeMin;
	}

	maxLife *= 1/30;
	minLife *= 1/30;

	this.lifetime = maxLife * 1000; //milliseconds
	// renderer is made by pixi.autoDetectRenderer
	this.texture = global.app.renderer.generateTexture(graphics);

	// 100 is 1 pixel per frame
	// i don't really know what the correct scaling is
	var velocity = (this.properties.velocity || 0) / 2;

	var emitterConfig = {
	    "alpha": {
		"start": 1,
		"end": 0
	    },
	    "scale": {
		"start": 0.1,
		"end": 0.1,
		"minimumScaleMultiplier": 1
	    },
	    "color": {
		"start": this.properties.color.toString(16),
		"end": this.properties.color.toString(16)
	    },
	    "speed": {
		"start": velocity,
		"end": velocity,
		"minimumSpeedMultiplier": 1
	    },
	    "acceleration": {
		"x": 0,
		"y": 0
	    },
	    "maxSpeed": 0,
	    "startRotation": {
		"min": 0,
		"max": 360
	    },
	    "noRotation": true,
	    "rotationSpeed": {
		"min": 0,
		"max": 0
	    },
	    "lifetime": {
		"min": minLife,
		"max": maxLife
	    },
	    "blendMode": "add",
	    "frequency": 0.016,
	    "emitterLifetime": -1,
	    "maxParticles": 1000,
	    "pos": {
		"x": 0,
		"y": 0
	    },
	    "addAtBack": false,
	    "spawnType": "burst",
	    "particlesPerWave": this.properties.number * this.factor,
	    "particleSpacing": 0,
	    "angleStart": 0
	};
	
	this.emitter = new PIXI.particles.Emitter(
	    this.container,
	    [this.texture],
	    emitterConfig
	);
	this.emitter.emit = false;

	//this.emitter.updateOwnerPos(0,0);
    }

    show() {
	// if (this.hideTimeout) {
	//     clearTimeout(this.hideTimeout);
	// }
	this.emitter.updateOwnerPos(this.source.position[0],
				    -this.source.position[1]);
	this._renderParticles(0);
	this.emitter.emit = true;
	this._waitingToStop = false;
	super.show();
	
    }
    hide() {
	// if (this.hideTimeout) {
	//     clearTimeout(this.hideTimeout);
	// }
	this.emitter.emit = false;
	
	this.emitter.cleanup();
	this.emitter.update(0.001); // maybe set this to 1?
	super.hide();
    }

    set emitParticles(v) {
	if (this.destroyed) {
	    console.warn("Tried to emit particles on destroyed particle emitter");
	    return;
	}
	if (v) {
	    this.show();
	}
	else {
	    this.emitter.emit = false;
	    this._justStopped = true;
	    // this.hideTimeout = setTimeout(function() {
	    // 	this.hide();
	    // }.bind(this), this.emitter.maxLifetime * 1000);
	}
    }
    get emitParticles() {
	return this.visible;
    }
    
    
    renderHit() {
	this.emitParticles = true;
	this._renderParticles(1000 / 60);
	this.emitParticles = false;
    }

    _renderParticles(delta) {
	this.emitter.frequency = 1 / global.framerate;
	this.emitter.updateOwnerPos(this.source.position[0],
				    -this.source.position[1]);
	this.emitter.update(delta * 0.001);
    }
    
    render(delta) {
	// Refactor with projectile.js
	super.render(...arguments);
	if (this._justStopped) {
	    this.hideTime = this.time + this.emitter.maxLifetime * 1000;
	    this._justStopped = false;
	    this._waitingToStop = true;
	}
	if (this._waitingToStop & this.hideTime < this.time) {
	    this.hide();
	    return;
	}
	this._renderParticles(delta);

    }

    _addToSystem() {
	this.system.container.addChild(this.container);
	super._addToSystem();
    }


    _removeFromSystem() {
	this.hide();
	this.system.container.removeChild(this.container);
	super._removeFromSystem();
    }

    _destroy() {
	Object.defineProperty(this, "emitParticles", {set:undefined}); // Kill the ability to emit
	this.renderHit = this.render = function() {
	    throw new Error("Tried to use destroyed particleEmitter");
	};
	// if (this.hideTimeout) {
	//     clearTimeout(this.hideTimeout);
	// }
	this.emitter.destroy();
	super._destroy();
    }
};

module.exports = particleEmitter;
