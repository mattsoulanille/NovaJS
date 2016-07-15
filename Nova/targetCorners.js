function targetCorners(name) {
    this.name = name || "targetCorners";
    spaceObject.call(this, this.name);
    this.textures = {};
}

targetCorners.prototype = new spaceObject;

targetCorners.prototype.makeSprites = function() {
    _.each(this.meta.images, function(image, key) {
	this.textures[key] = new PIXI.Texture.fromImage(this.url + image);
    }, this);

    this.sprites.topLeft = new PIXI.Sprite();
    this.sprites.topRight = new PIXI.Sprite();
    this.sprites.bottomLeft = new PIXI.Sprite();
    this.sprites.bottomRight = new PIXI.Sprite();

    _.each(this.sprites, function(spr) {
	spr.anchor.x = 0.5;
	spr.anchor.y = 0.5;
    }, this);

    this.sprites.bottomLeft.rotation = Math.PI * 3/2;
    this.sprites.bottomRight.rotation = Math.PI;
    this.sprites.topRight.rotation = Math.PI * 1/2;

}

targetCorners.prototype.makeSize = function() {
    this.size[0] = Math.max.apply(null, _.map(this.textures, function(texture) {
	return texture.width;
    }));

    this.size[1] = Math.max.apply(null, _.map(this.textures, function(texture) {
	return texture.height;
    }));

}

targetCorners.prototype.addSpritesToContainer = function() {
    _.each(this.sprites, function(spr) { this.spriteContainer.addChild(spr) }, this);
    this.renderReady = true;
    stage.addChild(this.spriteContainer);
}

targetCorners.prototype.callSprites = function(toCall) {
    _.each(this.sprites, toCall, this);
}

targetCorners.prototype.target = function(target) {
    this.position = target.position;
    this.callSprites(function(s) {s.texture = this.textures.neutral});
    this.placeSprites(target);
    this.show();
}

targetCorners.prototype.placeSprites = function(target) {
    this.sprites.topLeft.position.x = -target.size[0] / 2;
    this.sprites.topLeft.position.y = -target.size[1] / 2;

    this.sprites.topRight.position.x = target.size[0] / 2;
    this.sprites.topRight.position.y = -target.size[1] / 2;

    this.sprites.bottomLeft.position.x = -target.size[0] / 2;
    this.sprites.bottomLeft.position.y = target.size[1] / 2;

    this.sprites.bottomRight.position.x = target.size[0] / 2;
    this.sprites.bottomRight.position.y = target.size[1] / 2;

}
