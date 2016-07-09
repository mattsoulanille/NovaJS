/*
More of a dust field, really.
*/

function starfield(source, count, starname) {

    this.stars = [];
    this.spriteContainer = new PIXI.Container();
    this.count = count || 20;
    this.ready = false;
    this.source = source;
    this.url = 'objects/misc/';
    this.starName = starname || "star";
    this.autoRender = false;
}

starfield.prototype.build = function() {
    return this.loadResources()
	.then(this.buildTextures.bind(this))
	.then(this.buildStars.bind(this))
	.then(function() {
	    this.ready = true
	    stage.addChild(this.spriteContainer);
	}.bind(this))
        .catch(function(reason) {console.log(reason)});
}


starfield.prototype.loadResources = function() {
    return new RSVP.Promise(function(fulfill, reject) {
	
	var loader = new PIXI.loaders.Loader();
	loader
	    .add('spriteImageInfo', this.url + this.starName + ".json")
	    .load(function (loader, resource) {
		this.spriteImageInfo = resource.spriteImageInfo.data;
		
	    }.bind(this))
	    .once('complete', fulfill);

    }.bind(this));

}

starfield.prototype.buildTextures = function() {
    this.textures = _.map(_.keys(this.spriteImageInfo.frames), function(frame) {
	return PIXI.Texture.fromFrame(frame);
    });

}


starfield.prototype.buildStars = function() {

    for (i = 0; i < this.count; i++) {
	var starSprites = {};
	starSprites.star = {}
	starSprites.star.textures = this.textures
	starSprites.star.sprite = new PIXI.Sprite(starSprites.star.textures[0])

	var s = new star(starSprites, this.source, this.spriteContainer);
	this.stars.push(s);
    }


    _.each( this.stars, function(s) {s.build()});

}

starfield.prototype.placeStar = function(xrange,yrange) {
    //xrange and yrange are 2-element arrays
        
    for (i=0; i < this.stars.length; i++) {
	var s = this.stars[i];
	if (s.available === true) {
	    s.randomize()
	    s.position[0] = Math.floor(Math.random() * (xrange[1] - xrange[0]) + xrange[0])
	    s.position[1] = Math.floor(Math.random() * (yrange[1] - yrange[0]) + yrange[0])
	    s.show()
	    s.available = false;
	    return true
	}
    }
    return false
    
    
}

starfield.prototype.placeAll = function() {
    var xsize = $(window).width()
    var ysize = $(window).height()
    var xrange = [-xsize/2, xsize/2]
    var yrange = [-ysize/2, ysize/2]

    while (this.placeStar(xrange, yrange)) {
	//pass
    }
    this.startRender();
    
}

starfield.prototype.doAutoRender = function() {
    if (this.autoRender) {
	this.render();
	setTimeout(_.bind(this.doAutoRender, this), 0);
    }
}

starfield.prototype.startRender = function() {
    if (this.ready && !this.autoRender) {
	this.autoRender = true
	this.doAutoRender()
    }
}

starfield.prototype.stopRender = function() {
    this.autoRender = false;
}


starfield.prototype.render = function() {
    _.each(this.stars, function(s) {s.render()});

}
