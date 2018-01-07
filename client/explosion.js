
var explosion = class extends loadsResources(renderable(inSystem)) {
    constructor(buildInfo) {
	super();
	this.destroyed = false; // generalize this
	this.container = new PIXI.Container();
	this.container.visible = false;
	if (typeof buildInfo !== "undefined") {
	    this.buildInfo = buildInfo;
	    this.id = buildInfo.id;
	    this.spriteId = buildInfo.animation.id;
	    this.frameTime = buildInfo.animation.frameTime;
	}
	this.built = false;
	this.building = false;
	this.time = 0;
    }

    async build() {
	if (!this.built && !this.building) {
	    this.building = true;
	    var spriteSheet = await this.loadResources("spriteSheets", this.spriteId);
	    this.sprite = new sprite(spriteSheet.textures);
	    this.sprite.sprite.blendMode = PIXI.BLEND_MODES.ADD;
	    var frameCount = this.sprite.textures.length;
	    this.lifetime = this.frameTime * frameCount;
	    this.container.addChild(this.sprite.sprite);
	    this.built = true;
	}
    }

    explode(pos) {
	// Write some coordinate translater maybe.
	this.container.position.x = pos[0];
	this.container.position.y = -pos[1];
	this.time = 0;
	this.show();

    }
    render(delta) {
	this.time += delta;
	var frame = Math.floor(this.time / this.frameTime);
	if (frame < this.sprite.textures.length) {
	    this.sprite.sprite.texture = this.sprite.textures[frame];
	}
	else {
	    this.hide();
	}
	
    }

    _addToSystem() {
	this.system.container.addChild(this.container);
	super._addToSystem();
    }
    _removeFromSystem() {
	this.system.container.removeChild(this.container);
	super._removeFromSystem();
    }
    
    destroy() {
	if (this.destroyed) {
	    return;
	}
	this.container.destroy();
	super.destroy();
	this.destroyed = true;
    }

};
