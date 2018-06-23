
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
	this.queue = [];
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

    makeNewExplosion() {
	var expl = new explosionSprite(this.spriteSheet.textures, this.frameTime, this.queue);
	this.container.addChild(expl.container);
	this.addChild(expl);

    }
    
    explode(pos) {
	// Write some coordinate translater maybe.
	var toExplode = this.queue.shift();
	if (!toExplode) {
	    this.makeNewExplosion();
	    toExplode = this.queue.shift();
	}
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
