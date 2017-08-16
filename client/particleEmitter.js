


var particleEmitter = class extends inSystem {
    constructor(properties, source) {
	super(...arguments);
	this.source = source;
	this.properties = properties;
	this.container = new PIXI.Container();
	//space.addChild(this.container);

	// To Do: Make a stationary container. Put everything in it.
	
	//this.source.container.addChild(this.container);

	var graphics = new PIXI.Graphics;
	
	graphics.lineStyle(40, 0xFFFFFF);
	graphics.moveTo(0,0);
	graphics.lineTo(40,0);

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
	
	// renderer is made by pixi.autoDetectRenderer
	this.texture = renderer.generateTexture(graphics);

	// 100 is 1 pixel per frame
	
	var velocity = (this.properties.velocity || 0);

	var emitterConfig = {
	    "alpha": {
		"start": 1,
		"end": 1
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
		"min": maxLife,
		"max": minLife
	    },
	    "blendMode": "add",
	    "frequency": 0.01,
	    "emitterLifetime": -1,
	    "maxParticles": 1000,
	    "pos": {
		"x": 0,
		"y": 0
	    },
	    "addAtBack": false,
	    "spawnType": "burst",
	    "particlesPerWave": this.properties.number,
	    "particleSpacing": 0,
	    "angleStart": 0
	};
	
	this.emitter = new PIXI.particles.Emitter(
	    this.container,
	    [this.texture],
	    emitterConfig
	);

	//this.emitter.updateOwnerPos(0,0);
    }

    render() {
	this.emitter.updateOwnerPos(this.source.position[0],
				    -this.source.position[1]);
	this.emitter.update(this.source.delta * 0.001);
	
    }

    set emit(val) {
	this.emitter.updateOwnerPos(this.source.position[0],
				    -this.source.position[1]);
	this.emitter.emit = val;
	if (val === false) {
	    setTimeout(function() {
		this.emitter.cleanup();
		this.emitter.update(0.001);
	    }.bind(this), this.emitter.maxLifetime * 1000);
	}
    }
    get emit() {
	return this.emitter.emit;
    }

    _addToSystem() {
	this.system.container.addChild(this.container);
    }


    _removeFromSystem() {
	this.system.container.removeChild(this.container);
    }

    destroy() {
	this.emitter.destroy();
    }
    
};
