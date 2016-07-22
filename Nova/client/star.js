function star(source, starContainer, system, name) {
    movable.call(this, {"name":name}, system)
    this.url = 'objects/misc/';
    this.name = name || 'star';
    this.velocityFactor = 0;
    this.source = source;
    this.meta = {};
    this.meta.imageAssetsFiles = {"star": this.name + ".json"};
    this.properties = {};
    this.available = false;
    starContainer.addChild(this.spriteContainer);
}

//star.prototype.meta = {}

star.prototype = new movable;

star.prototype.build = function() {

    return this.makeSprites()
	.then(_.bind(this.addSpritesToContainer, this))
	.then(function() {
	    this.system.spaceObjects.push(this)
	    this.available = true;
	    this.renderReady = true;
	}.bind(this));
}

star.prototype.addSpritesToContainer = function() {

    _.each(this.sprites, function(s) {this.spriteContainer.addChild(s.sprite);}, this);

}


star.prototype.randomize = function() {
    this.chooseRandomTexture();
    this.velocityFactor = Math.random() / 2;
    
}

star.prototype.chooseRandomTexture = function() {

    var rand = Math.random()
    _.map(_.values(this.sprites), function(spr) {
	var randomSpriteIndex = Math.floor(rand * spr.textures.length);
	spr.sprite.texture = spr.textures[randomSpriteIndex]
    });
}



star.prototype.render = function() {
    this.velocity[0] = this.source.velocity[0] * this.velocityFactor;
    this.velocity[1] = this.source.velocity[1] * this.velocityFactor;

    movable.prototype.render.call(this)
	

}
