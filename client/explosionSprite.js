class explosionSprite extends visible(renderable(inSystem)) {
    constructor(textures, frameTime, queue) {
	super();
	//var textures = frameIDs.map(function(t) { return new PIXI.Texture.fromFrame(t); });
	
	this.sprite = new sprite(textures);
	this.sprite.sprite.blendMode = PIXI.BLEND_MODES.ADD;
	this.container.addChild(this.sprite.sprite);

	this.frameTime = frameTime;
	var frameCount = this.sprite.textures.length;
	this.lifetime = this.frameTime * frameCount;

	this.queue = queue; // parent's queue of ready explosionSprites
	this.queue.push(this);
	this.built = true;
    }

    explode(pos) {
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
	    this.queue.push(this); // It's ready again
	}
    }

};
