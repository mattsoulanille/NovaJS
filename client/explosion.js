
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
    }

    async build() {
	if (!this.built && !this.building) {
	    this.building = true;
	    this.spriteSheet = await this.loadResources("spriteSheets", this.spriteId);
	    var expl = new explosionSprite(this.spriteSheet.textures, this.frameTime, this.queue);
	    this.addChild(expl);
	    
	    this.built = true;
	}
    }

    explode(pos) {
	// Write some coordinate translater maybe.
	var toExplode = this.queue.pop();
	if (!toExplode) {
	    toExplode = new explosionSprite(this.spriteSheet, this.frameTime, this.queue);
	    this.addChild(toExplode);
	}
	toExplode.explode(pos);
    }

    
    destroy() {
	if (this.destroyed) {
	    return;
	}
	super.destroy();
    }

    addChild(child) {
	super.addChild(child);
	this.container.addChild(child.container);
    }

    removeChild(child) {
	super.removeChild(child);
	this.container.removeChild(child.container);
    }

};
