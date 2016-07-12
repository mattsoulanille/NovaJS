function statusBar(name) {
    this.url = "/objects/statusBars/"
    this.ready = false
    this.name = name;
    this.sprites = {};
    this.spriteContainer = new PIXI.Container();
}

statusBar.prototype.build = function() {
    return this.loadResources()
	.then(_.bind(this.makeSprites, this))
	.then(_.bind(this.addSpritesToContainer, this))
	.then(this.resize.bind(this))
//	.catch(function(err) {console.log(err)});
}

statusBar.prototype.loadResources = function() {
    return new Promise(function(fulfill, reject) {
	var jsonUrl = this.url + this.name + '.json';

	$.getJSON(jsonUrl, _.bind(function(data) {

	    this.meta = data;

	    if ((typeof(this.meta) !== 'undefined') && (this.meta !== null)) {
		fulfill();
	    }
	    else {
		reject();
	    }

	}, this));


    }.bind(this));

}

statusBar.prototype.makeSprites = function() {
    _.each(_.keys(this.meta.imageAssetsFiles), function(key) {
	if (this.meta.imageAssetsFiles.hasOwnProperty(key)) {
	    this.sprites[key] = new sprite(this.url + this.meta.imageAssetsFiles[key], [1,0]);
	}
    }, this);

    return Promise.all(  _.map(_.values(this.sprites), function(s) {return s.build()})  )
	.then(function() {
	    this.renderReady = true;
	}.bind(this));

}

statusBar.prototype.addSpritesToContainer = function() {
    _.each(_.map(_.values(this.sprites), function(s) {return s.sprite;}),
	   function(s) {this.spriteContainer.addChild(s);}, this);

    stage.addChild(this.spriteContainer);
}

statusBar.prototype.resize = function() {
    this.spriteContainer.position.x = $(window).width();
}

statusBar.prototype.render = function() {
    
}
