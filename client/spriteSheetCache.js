
var spriteSheetCache = class extends cache {

    constructor() {
	super(...arguments);
    }


    //get
    
    get(id) {

	if ( !(id in this.cached) ) {
	    //this.cached[id] = this.getURL(this.prefix_url + id);
	    this.cached[id] = new Promise(async function(fulfill, reject) {
		var result = {};
		var frameInfo = await this.getURL(this.prefix_url + id + "/frameInfo.json");

		result.textures = Object.keys(frameInfo.frames).map(function(frame) {
		    return PIXI.Texture.fromFrame(frame);
		    // how the heck does this even work?!?!
		    // PIXI is weird
		});
		result.convexHulls = await this.getURL(this.prefix_url + id + "/convexHulls.json");

		fulfill(result);

	    }.bind(this));
	}

	return this.cached[id];
    }

};
