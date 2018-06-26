var visible = require("./visible.js");
var loadsResources = require("./loadsResources.js");
var inSystem = require("./inSystem.js");
var explosionSprite = require("./explosionSprite.js");
var explosion = class extends loadsResources(visible(inSystem)) {
    constructor(buildInfo) {
	super();
	this.destroyed = false; // generalize this
	if (typeof buildInfo !== "undefined") {
	    this.buildInfo = buildInfo;
	    this.id = buildInfo.id;
	    this.spriteId = buildInfo.animation.id;
	    this.frameTime = buildInfo.animation.frameTime;
	}
	this.built = false;
	this.building = false;
	this.time = 0;
	this.queue = new factoryQueue(this.makeNewExplosion.bind(this));
	this.show();
    }

    async build() {
	if (!this.built && !this.building) {
	    this.building = true;
	    this.spriteSheet = await this.loadResources("spriteSheets", this.spriteId);
	    this.makeNewExplosion();
	    this.built = true;
	}
    }

    makeNewExplosion(enqueue) {
	var expl = new explosionSprite(this.spriteSheet.textures, this.frameTime, enqueue);
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
