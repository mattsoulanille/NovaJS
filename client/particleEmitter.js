
var particleEmitter = class extends renderable(inSystem) {
    constructor(properties, source) {
	super(...arguments);
	this.factor = 0.5;
	this.source = source;
	this.properties = properties;
	this.container = new PIXI.Container();
	this.built = true;
	this.hideTimeout = null;
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
	this.texture = app.renderer.generateTexture(graphics);

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
	if (this.hideTimeout) {
	    clearTimeout(this.hideTimeout);
	}
	this.emitter.updateOwnerPos(this.source.position[0],
				    -this.source.position[1]);
	this.render(0);
	this.emitter.emit = true;
	super.show();
	
    }
    hide() {
	if (this.hideTimeout) {
	    clearTimeout(this.hideTimeout);
	}
	this.emitter.emit = false;
	
	this.emitter.cleanup();
	this.emitter.update(0.001); // maybe set this to 1?
	super.hide();
    }

    set emit(v) {
	if (this.destroyed) {
	    return;
	}
	if (v) {
	    this.show();
	}
	else {
	    this.emitter.emit = false;
	    this.hideTimeout = setTimeout(function() {
		this.hide();
	    }.bind(this), this.emitter.maxLifetime * 1000);
	}
    }
    get emit() {
	return this.visible;
    }
    
    
    renderHit() {
	this.emit = true;
	this.render(1000 / 60);
	this.emit = false;
    }
    
    render(delta) {
	// if (environment.framerate > 15) {
	//     this.emitter.frequency = 1 / environment.framerate;
	// }
	// else {
	//     this.emitter.frequency = 0;
	// }

	this.emitter.frequency = 1 / environment.framerate;
	this.emitter.updateOwnerPos(this.source.position[0],
				    -this.source.position[1]);
	this.emitter.update(delta * 0.001);

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

    destroy() {
	Object.defineProperty(this, "emit", {set:undefined}); // Kill the ability to emit
	if (this.hideTimeout) {
	    clearTimeout(this.hideTimeout);
	}
	this.emitter.destroy();
	super.destroy();
    }
    
};
