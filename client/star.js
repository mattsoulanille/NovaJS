

var star = class extends movable(spaceObject) {

    constructor(source, starContainer, system, id = "nova:700") {
	super({}, system);
	
	this.velocityFactor = 0;
	this.attach(source);
	this.meta = {};
	this.meta.imageAssetsFiles = {"star": this.name + ".json"};
	this.properties = {};
	this.available = false;
	starContainer.addChild(this.container);
	this.built = false;
    }
    
    //star.prototype.meta = {}
    attach(source) {
	this.source = source;
    }
    
    build() {
	this.meta = {
	    animation: {
		images: {
		    baseImage: {id:"nova:700"}
		}
	    }
	};

	return this.makeSprites()
	    .then(_.bind(this.addSpritesToContainer, this))
	    .then(function() {
		//this.system.spaceObjects.push(this)
		this.available = true;
		this.renderReady = true;
		this.built = true;
	    }.bind(this));
    }

    addSpritesToContainer() {
	_.each(this.sprites, function(s) {this.container.addChild(s.sprite);}, this);
    }

    // addToSpaceObjects() {
    // 	this.system.built.spaceObjects.push(this);
    // }
    
    randomize() {
	this.chooseRandomTexture();
	this.velocityFactor = Math.random() / 2;
    }

    chooseRandomTexture() {

	var rand = Math.random();
	_.map(_.values(this.sprites), function(spr) {
	    var randomSpriteIndex = Math.floor(rand * spr.textures.length);
	    spr.sprite.texture = spr.textures[randomSpriteIndex];
	});
    }
    


    render() {
	this.velocity[0] = this.source.velocity[0] * this.velocityFactor;
	this.velocity[1] = this.source.velocity[1] * this.velocityFactor;
	super.render.call(this);
    }
};
