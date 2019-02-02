var sprite = require("./sprite.js");
var _ = require("underscore");
var errors = require("../client/errors.js");
var NoSystemError = errors.NoSystemError;
var PIXI = require("../server/pixistub.js");
var buildable = require("./buildable.js");
var destroyable = require("./destroyable.js");
var inSystem = require("./inSystem.js");
var renderable = require("./renderable.js");
const loadsResources = require("./loadsResources.js");
const visible = require("./visible.js");
const placeable = require("../server/placeableServer.js");

class targetCorners extends placeable(visible(loadsResources(renderable(destroyable(buildable(inSystem)))))) {

    constructor(system, id = "targetCorners") {
	super();
	this.id = id;
	this.system = system;
	this.type = 'TargetCorners';
	this.textures = {};
	this.targetTime = this.time;

	this.topLeftContainer = new PIXI.Container();
	this.topRightContainer = new PIXI.Container();
	this.topRightContainer.rotation = 1/2 * Math.PI;
	this.bottomLeftContainer = new PIXI.Container();
	this.bottomLeftContainer.rotation = 3/2 * Math.PI;
	this.bottomRightContainer = new PIXI.Container();
	this.bottomRightContainer.rotation = Math.PI;
	this.corners = [this.topLeftContainer, this.topRightContainer,
			this.bottomLeftContainer, this.bottomRightContainer];

    	this.corners.forEach(function(c) {
	    this.addChild(c);
	    this.container.addChild(c);
	}.bind(this));

	this.topLeft = [];
	this.topRight = [];
	this.bottomLeft = [];
	this.bottomRight = [];
	this.activeSpriteIndex = 0;
    }

    async _build() {
	this.meta = await this.data[this.type].get(this.id);

	var cornerSprites = [this.topLeft, this.topRight, this.bottomLeft, this.bottomRight];
	for (let i in this.meta.images) {
	    var id = this.meta.images[i];
	    for (let j in cornerSprites) {
		var s = new sprite(id);
		var container = this.corners[j];
		await s.build();
		container.addChild(s.sprite);
		cornerSprites[j].push(s);
	    }		
	}
	super._build();
    }

    
    setTarget(target) {
	if (target) {
	    this.position = target.position;
	    this.activeSpriteIndex = 0; // TODO: Make it easier to change the color
	    this.setVisibleSprites();
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

    setVisibleSprites() {
	var cornerSprites = [this.topLeft, this.topRight, this.bottomLeft, this.bottomRight];
	for (let i in cornerSprites) {
	    var spriteList = cornerSprites[i];
	    for (let j in spriteList) {
		var s = spriteList[j];
		s.sprite.visible = (j == this.activeSpriteIndex);
	    }
	}
    }

    placeSprites(target, scale) {

	this.topLeftContainer.position.x = -target.size[0] / 2 * scale;
	this.topLeftContainer.position.y = -target.size[1] / 2 * scale;

	this.topRightContainer.position.x = target.size[0] / 2 * scale;
	this.topRightContainer.position.y = -target.size[1] / 2 * scale;

	this.bottomLeftContainer.position.x = -target.size[0] / 2 * scale;
	this.bottomLeftContainer.position.y = target.size[1] / 2 * scale;

	this.bottomRightContainer.position.x = target.size[0] / 2 * scale;
	this.bottomRightContainer.position.y = target.size[1] / 2 * scale;

    }

    _addToSystem() {
	super._addToSystem();
	this._addToContainer();
    }
    _removeFromSystem() {
	super._removeFromSystem();
	this._removeFromContainer();
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
