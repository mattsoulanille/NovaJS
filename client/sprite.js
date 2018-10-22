const PIXI = require("../server/pixistub.js");
const buildable = require("./buildable.js");
const destroyable = require("./destroyable.js");
const loadsResources = require("./loadsResources.js");

class sprite extends loadsResources(buildable(destroyable(function() {}))) {
    constructor(spriteSheetID) {
	super();
	this.spriteSheetID = spriteSheetID;
	this.sprite = new PIXI.Sprite();
	this.sprite.anchor.x = 0.5;
	this.sprite.anchor.y = 0.5;
    }

    async _build() {
	
	var spriteSheet = await this.data.spriteSheets.get(this.spriteSheetID);

	var frameInfo = await this.data.spriteSheetFrames.get(this.spriteSheetID);
	
	this.textures = Object.keys(frameInfo.frames).map(function(frame) {
	    return PIXI.Texture.fromFrame(frame);
	});
	
	this.convexHulls = spriteSheet.convexHulls;

	if (this.textures) {
	    this.sprite.texture = this.textures[0];
	}
	
    }
    
    _destroy() {
	this.sprite.destroy();
	super._destroy();
    }

    
};
module.exports = sprite;

