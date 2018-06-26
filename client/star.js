var spaceObject = require("./spaceObject.js");
var _ = require("underscore");
var star = class extends spaceObject {

    constructor(source, starContainer, system, rtree, screenDimensions, id = "nova:700") {
	super({}, system);
	this.tree = rtree;
	this.attach(source);
	this.properties = {};
	this.available = false;
	starContainer.addChild(this.container);
	this.built = false;
	// x, y, and an approximation for z
	this.realPosition = [0, 0, 0];
	
	this.meta = {
	    animation: {
		images: {
		    baseImage: {id:"nova:700"}
		}
	    }
	};
	this.rbushEntry = {
	    minX: 0,
	    minY: 0,
	    maxX: 1,
	    maxY: 1,
	    star: this
	};
	this.screenDimensions = screenDimensions;
    }

    _addToRendering() {
	// Don't add it. It is rendered by starfield which checks the rtree
    }
    
    //star.prototype.meta = {}
    attach(source) {
	this.source = source;
    }
    async _loadMeta() {}
    
    async _build() {
	await super._build();
    }

    resize(x, y) {
	this.screenDimensions = [x, y];
	this._makeRBushEntry();
    }
    
    _makeRBushEntry() {
	//var pos = this.position;
	this.tree.remove(this.rbushEntry);
	//var scale = 1 / this.realPosition[2];
	var pos = [this.realPosition[0],
		   this.realPosition[1]];

	// size from movement factor
	// Where a star appears at w = screenW / 2,
	// and where D = |shipPos - realPosition|,
	// and where factor = realPosition[2],
	// Bounding box length (one side) = D - w = D * factor, so
	// D = w / (1 - factor), so
	// D - w = w / (1 - factor) - w
	// D - w = (1 / (1 - factor) - 1)*w
	var unitLengthOffset = (1 / (1 - this.realPosition[2]) - 1);
	var sfmf = [unitLengthOffset * this.screenDimensions[0] / 2,
		    unitLengthOffset * this.screenDimensions[1] / 2];

	//var size = [this.size[0] + sfmf[0], this.size[1] + sfmf[1]];
	var size = this.size;
	this.rbushEntry = {
	    minX: pos[0] - size[0] / 2 - sfmf[0],
	    minY: pos[1] - size[1] / 2 - sfmf[1],
	    maxX: pos[0] + size[0] / 2 + sfmf[0],
	    maxY: pos[1] + size[1] / 2 + sfmf[1],
	    star: this
	};
	this.tree.insert(this.rbushEntry);
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
	//this.realPosition[2] = 0.5;
	//this.realPosition[2] = 0;
	this._makeRBushEntry();
    }
    place(pos) {
	
	this.realPosition[0] = pos[0];
	this.realPosition[1] = pos[1];
	this._makeRBushEntry();
    }

    chooseRandomTexture() {

	var rand = Math.random();
	//var rand = 0.99;
	Object.values(this.sprites).map(function(spr) {
	    var randomSpriteIndex = Math.floor(rand * spr.textures.length);
	    spr.sprite.texture = spr.textures[randomSpriteIndex];
	});
    }
    


    render() {
	// realPosition
	// + dynamic offset due to ship position
	// - correction factor to make it so that when the ship is at the star's realPosition,
	// the ship is on top of the star.
	this.position[0] = this.realPosition[0]
	    + this.source.position[0] * this.realPosition[2]
	    - this.realPosition[0] * this.realPosition[2];

	this.position[1] = this.realPosition[1]
	    + this.source.position[1] * this.realPosition[2]
	    - this.realPosition[1] * this.realPosition[2];

	super.render(...arguments);
    }
};
module.exports = star;
