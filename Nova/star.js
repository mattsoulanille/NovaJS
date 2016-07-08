function star(source, name) {
    movable.call(this, name)
    this.url = 'objects/misc/';
    this.name = name || 'star';
    this.velocityFactor = 0;
    this.source = source;
    this.meta = {};
    this.meta.imageAssetsFiles = {"star": this.name + ".json"};
    this.properties = {};
    this.available = false;
}

//star.prototype.meta = {}

star.prototype = new movable;

star.prototype.build = function() {

    return this.makeSprites()
	.then(this.addSpritesToContainer.bind(this))
	.then(function() {
	    this.available = true;
	}.bind(this))
	.catch(function(reason) {console.log(reason)});

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
