const factoryQueue = require("../libraries/factoryQueue.js");
const visible = require("./visible.js");
const loadsResources = require("./loadsResources.js");
const inSystem = require("./inSystem.js");
const explosionSprite = require("./explosionSprite.js");
const buildable = require("./buildable.js");

class explosion extends buildable(loadsResources(visible(inSystem))) {
    constructor(buildInfo) {
	super();
	if (typeof buildInfo !== "undefined") {
	    this.buildInfo = buildInfo;
	    this.id = buildInfo.id;
	    this.spriteID = buildInfo.animation.id;
	    this.frameTime = buildInfo.animation.frameTime;
	}
	this.built = false;
	this.building = false;
	this.time = 0;
	this.queue = new factoryQueue(this.makeNewExplosion.bind(this));
	this.show();
    }

    async _build() {
	await this.queue.prebuild(1);
	await super._build();
    }

    async makeNewExplosion(enqueue) {
	var expl = new explosionSprite(this.spriteID, this.frameTime, enqueue);
	await expl.build();
	this.container.addChild(expl.container);
	this.addChild(expl);
	return expl;
    }
    
    async explode(pos, delay=0) {
	// Write some coordinate translater maybe.
	if (delay > 0) { // cheapo delay hack
	    await new Promise(function(fulfill, reject) {
		setTimeout(fulfill, delay);
	    });
	}
	var toExplode = await this.queue.get();
	toExplode.explode(pos);
    }

    _addToSystem() {
	super._addToSystem();
	this.system.container.addChild(this.container);
    }

    _removeFromSystem() {
	super._removeFromSystem();
	this.system.container.removeChild(this.container);
    }
};

module.exports = explosion;
