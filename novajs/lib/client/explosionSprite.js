const PIXI = require("../server/pixistub.js");
const visible = require("./visible.js");
const renderable = require("./renderable.js");
const inSystem = require("./inSystem.js");
const sprite = require("./sprite.js");
const buildable = require("./buildable.js");

class explosionSprite extends buildable(visible(renderable(inSystem))) {
    constructor(spriteID, frameTime, enqueue) {
	super();
	//var textures = frameIDs.map(function(t) { return new PIXI.Texture.fromFrame(t); });
	
	this.sprite = new sprite(spriteID);
	this.sprite.sprite.blendMode = PIXI.BLEND_MODES.ADD;
	this.container.addChild(this.sprite.sprite);

	this.frameTime = frameTime;

	this.enqueue = enqueue; // The enqueue function to call when it's ready again.
    }

    async _build() {
	await this.sprite.build();
	var frameCount = this.sprite.textures.length;
	this.lifetime = this.frameTime * frameCount;

	await super._build();
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
	    this.enqueue(this); // it's ready again
	}
    }

};

module.exports = explosionSprite;
