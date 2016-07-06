function sprite(url) {
    this.url = url;
    this.renderReady = false;
}

sprite.prototype.build = function(callback) {
//    console.log("loading sprite: " + this.url);
    this.callback = callback;
    var loader = new PIXI.loaders.Loader();
    loader
	.add('spriteImageInfo', this.url)
	.load(function (loader, resource) {
	    this.spriteImageInfo = resource.spriteImageInfo.data;

	}.bind(this))
	.once('complete', sprite.prototype.onAssetsLoaded.bind(this));
    

};

// sprite.prototype.interpretSpriteImageJson = function() {
//     //this.spriteImageInfo = evt.content.json;
//     console.log(this.spriteImageInfo.meta.imagePurposes);
//     c = sprite.prototype.onAssetsLoaded.bind(this);
//     c();
// /*
//     var spriteAssetsToLoad = [this.url];
//     var spriteLoader = new PIXI.AssetLoader(spriteAssetsToLoad);
//     spriteLoader.onComplete = _.bind(this.onAssetsLoaded, this);
//     spriteLoader.load();
// */
// }

sprite.prototype.onAssetsLoaded = function() {
    // Get a list of the textures for the sprite.
//    console.log(this);
    this.textures = _.map(_.keys(this.spriteImageInfo.frames),
			  function(frame) { return(PIXI.Texture.fromFrame(frame)); });

    this.sprite = new PIXI.Sprite(this.textures[0]);
    this.sprite.anchor.x = 0.5;
    this.sprite.anchor.y = 0.5;
    //stage.addChild(this.sprite)
    this.renderReady = true;
//    console.log("loaded assets for " + this.url); //should happen when sprite is finished loading
    this.callback();
}
