var PIXI = require("../server/pixistub.js");

var sprite = class {
    constructor(textures, convexHulls) {
	this.sprite = new PIXI.Sprite();
	this.sprite.anchor.x = 0.5;
	this.sprite.anchor.y = 0.5;
	
	this.textures = textures;
	this.convexHulls = convexHulls;

	if (this.textures) {
	    this.sprite.texture = this.textures[0];
	}
	
    }
};
sprite.prototype.destroy = function() {
    this.sprite.destroy();
};
module.exports = sprite;

