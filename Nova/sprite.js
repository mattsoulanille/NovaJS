function sprite(url) {
    this.url = url
    this.renderReady = false
}

sprite.prototype.build = function(callback) {
    console.log("loading sprite: " + this.url)
    this.callback = callback
    var loader = new PIXI.JsonLoader(this.url);
    loader.on('loaded', _.bind(this.interpretSpriteImageJson, this))
    loader.load()
}

sprite.prototype.interpretSpriteImageJson = function(evt) {
    this.spriteImageInfo = evt.content.json
    //console.log(this.spriteImageInfo.meta.imagePurposes)

    var spriteAssetsToLoad = [this.url]
    var spriteLoader = new PIXI.AssetLoader(spriteAssetsToLoad)
    spriteLoader.onComplete = _.bind(this.onAssetsLoaded, this)
    spriteLoader.load()
}

sprite.prototype.onAssetsLoaded = function() {
    // Get a list of the textures for the sprite.
    this.textures = _.map(_.keys(this.spriteImageInfo.frames),
			 function(frame) { return(PIXI.Texture.fromFrame(frame)) })

    this.sprite = new PIXI.Sprite(this.textures[0])
    this.sprite.anchor.x = 0.5
    this.sprite.anchor.y = 0.5
    //stage.addChild(this.sprite)
    this.renderReady = true
    console.log("loaded assets for " + this.url) //should happen when sprite is finished loading
    this.callback()
}
