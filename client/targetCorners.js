targetCorners = class extends spaceObject {

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

	_.each(this.sprites, function(spr) {
	    // spr.anchor.x = 0.5;
	    // spr.anchor.y = 0.5;
	    
	}, this);

	this.sprites.bottomLeft.rotation = Math.PI * 3/2;
	this.sprites.bottomRight.rotation = Math.PI;
	this.sprites.topRight.rotation = Math.PI * 1/2;

    }

    addSpritesToContainer() {
	_.each(this.sprites, function(spr) { this.container.addChild(spr) }, this);
	this.renderReady = true;
	space.addChild(this.container); // maybe it should add to statusBar's contianer?
    }

    callSprites(toCall) {
	_.each(this.sprites, toCall, this);
    }

    target(target) {
	this.position = target.position;
	this.callSprites(function(s) {s.texture = this.textures.neutral});

	this.targetTime = this.time;
	this.placeSprites(target, 1);
	this.other = target;
	this.show();
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

    render() {
	if (this.other) {
	    if ( (!this.other.rendered) && this.other.visible ) {
		// seems a bit insane perhaps to be rendering others
		// necessarry so it tracks correctly
		// and uses the most up to date position
		this.other.render();
	    }

	    var time = 100;
	    var timeLeft = (time - (this.time - this.targetTime));
	    if (timeLeft < 0) {timeLeft = 0;}
	    var scale = (timeLeft/20) + 1;
	    this.placeSprites(this.other, scale);
	}
	super.render.call(this);
    }
    /*
    destroy() {
	super.destroy.call(this);
	console.log("destroying targetCorners");
    }
    */
    
};
