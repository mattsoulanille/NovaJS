function sprite(url) {
    this.url = url;
    this.renderReady = false;
}

sprite.prototype.build = function() {
//    console.log("loading sprite: " + this.url);

    if ( !((textures) && (textures[this.url])) ) {
	console.log("loading texture " + this.url)
	textures[this.url] = this.setTextures()

    }	

    return textures[this.url]
	.then(function(data) {
	    
	    this.textures = data[0];
	    this.spriteImageInfo = data[1];
	    
	}.bind(this))
	.then(_.bind(this.onAssetsLoaded, this))

};

sprite.prototype.loadResources = function() {

    return new RSVP.Promise(function(fulfill, reject) {
	var spriteImageInfo;
	var loader = new PIXI.loaders.Loader();
	var url = this.url
	loader
	    .add('spriteImageInfo', url)
	    .load(function (loader, resource) {
		spriteImageInfo = resource.spriteImageInfo.data;
		
	    })
	    .once('complete', function() {fulfill(spriteImageInfo)});

    }.bind(this));
}

sprite.prototype.setTextures = function() {

    return this.loadResources()
	.then(function(spriteImageInfo) {

	    return new RSVP.Promise(function(fulfill, reject) {
		// textures of the sprite
		var t = _.map(_.keys(spriteImageInfo.frames),
			      function(frame) { return(PIXI.Texture.fromFrame(frame)); });

		fulfill([t, spriteImageInfo]);
	    }.bind(this))

	}.bind(this))
}
    

sprite.prototype.onAssetsLoaded = function() {
    // Get a list of the textures for the sprite.
    return new RSVP.Promise(function(fulfill, reject) {

	this.sprite = new PIXI.Sprite(this.textures[0]);
	this.sprite.anchor.x = 0.5;
	this.sprite.anchor.y = 0.5;
	//stage.addChild(this.sprite)
	this.renderReady = true;
	//    console.log("loaded assets for " + this.url); //should happen when sprite is finished loading
	fulfill()
    }.bind(this));
}
