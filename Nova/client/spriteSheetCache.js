
var spriteSheetCache = class extends cache {

    constructor() {
	super(...arguments);
    }


    //get
    
    async get(id) {

	if ( !(id in this.cached) ) {
	    //this.cached[id] = this.getURL(this.prefix_url + id);
	    var frameInfo = await this.getURL(this.prefix_url + id + "/frameInfo.json");
	    
	    var textures = Object.keys(frameInfo.frames).map(function(frame) {
		return PIXI.Texture.fromFrame(frame);
		// how the heck does this even work?!?!
		// PIXI is weird
	    });

	    this.cached[id] = textures;
	    
	}

	return this.cached[id];
    }

};
