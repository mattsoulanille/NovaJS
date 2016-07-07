function sprite(url) {
    this.url = url;
    this.renderReady = false;
}

sprite.prototype.build = function() {
//    console.log("loading sprite: " + this.url);


    return this.loadResources()
	.then(_.bind(this.onAssetsLoaded, this))
    
};

sprite.prototype.loadResources = function() {

    return new RSVP.Promise(function(fulfill, reject) {
	
	var loader = new PIXI.loaders.Loader();
	loader
	    .add('spriteImageInfo', this.url)
	    .load(function (loader, resource) {
		this.spriteImageInfo = resource.spriteImageInfo.data;
		
	    }.bind(this))
	    .once('complete', fulfill);

    }.bind(this));
}

    

sprite.prototype.onAssetsLoaded = function() {
    // Get a list of the textures for the sprite.
    return new RSVP.Promise(function(fulfill, reject) {
	this.textures = _.map(_.keys(this.spriteImageInfo.frames),
			      function(frame) { return(PIXI.Texture.fromFrame(frame)); });

	this.sprite = new PIXI.Sprite(this.textures[0]);
	this.sprite.anchor.x = 0.5;
	this.sprite.anchor.y = 0.5;
	//stage.addChild(this.sprite)
	this.renderReady = true;
	//    console.log("loaded assets for " + this.url); //should happen when sprite is finished loading
	fulfill()
    }.bind(this));
}
