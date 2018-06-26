var spaceObject = require("./spaceObject.js");
var _ = require("underscore");
var errors = require("../client/errors.js");
var NoSystemError = errors.NoSystemError;
var PIXI = require("../server/pixistub.js");

var targetCorners = class extends spaceObject {

    constructor(system, id = "targetCorners") {
	super({"id": id}, system);
	this.type = 'misc';
	this.textures = {};
	this.targetTime = this.time;
	this.url = "objects/" + this.type + "/"; // replace with loadsResources
    }

    makeSprites() {
	_.each(this.meta.animation.pictures, function(image, key) {
	    this.textures[key] = new PIXI.Texture.fromImage(this.url + image);
	}, this);
	
	this.sprites.topLeft = new PIXI.Sprite();
	this.sprites.topRight = new PIXI.Sprite();
	this.sprites.bottomLeft = new PIXI.Sprite();
	this.sprites.bottomRight = new PIXI.Sprite();


	this.sprites.bottomLeft.rotation = Math.PI * 3/2;
	this.sprites.bottomRight.rotation = Math.PI;
	this.sprites.topRight.rotation = Math.PI * 1/2;

    }

    addSpritesToContainer() {
	_.each(this.sprites, function(spr) { this.container.addChild(spr) }, this);
	this.renderReady = true;
	this.system.container.addChild(this.container); // maybe it should add to statusBar's contianer?
    }

    callSprites(toCall) {
	_.each(this.sprites, toCall, this);
    }

    setTarget(target) {
	if (target) {
	    this.position = target.position;
	    this.callSprites(function(s) {s.texture = this.textures.neutral});
	    
	    this.timeLeft = 100; //milliseconds
	    this.placeSprites(target, 1);
	    this.other = target;

	    // Using hide() here makes an infinite recursion
	    this.setVisible(true);
	    this.setRendering(true);
	}
	else {
	    this.setVisible(false);
	    try {
		this.setRendering(false);
	    }
	    catch(e) {
		if (! (e instanceof NoSystemError) ) {
		    throw e;
		}
	    }
	}
    }

    placeSprites(target, scale) {

	this.sprites.topLeft.position.x = -target.size[0] / 2 * scale;
	this.sprites.topLeft.position.y = -target.size[1] / 2 * scale;

	this.sprites.topRight.position.x = target.size[0] / 2 * scale;
	this.sprites.topRight.position.y = -target.size[1] / 2 * scale;

	this.sprites.bottomLeft.position.x = -target.size[0] / 2 * scale;
	this.sprites.bottomLeft.position.y = target.size[1] / 2 * scale;

	this.sprites.bottomRight.position.x = target.size[0] / 2 * scale;
	this.sprites.bottomRight.position.y = target.size[1] / 2 * scale;

    }

    render(delta, time) {
	//this.time = time;
	if (this.other) {
	    if ( (!this.other.rendered) && this.other.visible ) {
		// seems a bit insane perhaps to be rendering others
		// necessarry so it tracks correctly
		// and uses the most up to date position
		this.other.render(...arguments);
	    }

	    this.timeLeft = this.timeLeft - delta;
	    if (this.timeLeft < 0) {this.timeLeft = 0;}
	    var scale = (this.timeLeft/20) + 1;
	    this.placeSprites(this.other, scale);
	}
	//super.render.call(this);
	super.render(delta, time);
    }
    /*
    destroy() {
	super.destroy.call(this);
	console.log("destroying targetCorners");
    }
    */
    
};
module.exports = targetCorners;
