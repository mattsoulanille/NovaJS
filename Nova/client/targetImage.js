function targetImage(name) {
    var url = "objects/targetImages/";
    this.ready = false;
    this.name = name;
    this.sprite;
    this.url = url + this.name

}

targetImage.prototype.build = function() {
    if ( !((textures) && (textures[this.url])) ) {
        console.log("loading texture " + this.url)
        textures[this.url] = this.loadTexture()
	
     }	
    

    return textures[this.url]
	.then(function(texture) {
	    this.texture = texture
	    this.sprite = new PIXI.Sprite(this.texture);
	    this.sprite.visible = false;
	    this.sprite.anchor.x = 0.5;
	    this.sprite.anchor.y = 0.5;
	}.bind(this));
	        
}


targetImage.prototype.loadTexture = function() {
    return new Promise(function(fulfill, reject) {
	var picture;
	var loader = new PIXI.loaders.Loader();
	loader
	    .add("picture", this.url)
	    .load(function(loader, resource) {

		texture = resource.picture.texture;
	    })
	    .once('complete', function() {fulfill(texture)});

    }.bind(this));

}

    
