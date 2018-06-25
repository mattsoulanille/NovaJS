var visible = require("./visible.js");
var renderable = require("./renderable.js");
var inSystem = require("./inSystem.js");
var sprite = require("./sprite.js");

class explosionSprite extends visible(renderable(inSystem)) {
    constructor(textures, frameTime, enqueue) {
	super();
	//var textures = frameIDs.map(function(t) { return new PIXI.Texture.fromFrame(t); });
	
	this.sprite = new sprite(textures);
	this.sprite.sprite.blendMode = PIXI.BLEND_MODES.ADD;
	this.container.addChild(this.sprite.sprite);

	this.frameTime = frameTime;
	var frameCount = this.sprite.textures.length;
	this.lifetime = this.frameTime * frameCount;

	this.enqueue = enqueue; // The enqueue function to call when it's ready again.
	
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
	    this.enqueue(this); // it's ready again
	}
    }

};

module.exports = explosionSprite;
