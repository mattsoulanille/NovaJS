var spaceObject = require("./spaceObject.js");
var _ = require("underscore");
var star = class extends spaceObject {

    constructor(source, starContainer, system, id = "nova:700") {
	super({}, system);
	
	this.attach(source);
	this.meta = {};
	this.meta.imageAssetsFiles = {"star": this.name + ".json"};
	this.properties = {};
	this.available = false;
	starContainer.addChild(this.container);
	this.built = false;
	// x, y, and an approximation for z
	this.realPosition = [0, 0, 0];
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
	this.realPosition[2] = Math.random() / 2;
    }

    chooseRandomTexture() {

	var rand = Math.random();
	_.map(_.values(this.sprites), function(spr) {
	    var randomSpriteIndex = Math.floor(rand * spr.textures.length);
	    spr.sprite.texture = spr.textures[randomSpriteIndex];
	});
    }
    


    render() {
	this.position[0] = this.realPosition[0] + this.source.position[0] * this.realPosition[2];
	this.position[1] = this.realPosition[1] + this.source.position[1] * this.realPosition[2];
	
	super.render(...arguments);
    }
};
module.exports = star;
