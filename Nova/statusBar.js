function statusBar(name, player) {
    this.url = "/objects/statusBars/"
    this.ready = false
    this.name = name;
    this.sprites = {};
    this.spriteContainer = new PIXI.Container();
    this.lines = new PIXI.Graphics();
    this.spriteContainer.addChild(this.lines)
    this.source = player;
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
	   function(s) {this.spriteContainer.addChildAt(s,0);}, this);

    stage.addChild(this.spriteContainer);
}

statusBar.prototype.resize = function() {
    this.spriteContainer.position.x = $(window).width();
}

statusBar.prototype.render = function() {
    // Line positions:
    // shield: -159,202 to -10,202 width 7
    // armor:  -158,216 to -10,222
    // energy: -158,234 to -10,240

    this.lines.clear();
    this.drawShields();
    this.drawArmor();
    this.drawEnergy();
}

statusBar.prototype.drawShields = function() {
    // shield: -159,202 to -10,202 width 7
    this.lines.lineStyle(7, 0xBF0000);
    this.lines.moveTo(-159,202);
    
    var totalLength = 149;
    var length = totalLength * this.source.shield / this.source.properties.maxShields;
    var lineTo = length -159;
    
    this.lines.lineTo(lineTo,202);
    
}

statusBar.prototype.drawArmor = function() {

    this.lines.lineStyle(7, 0xA6A6A6);
    this.lines.moveTo(-159, 219);

    var totalLength = 149;
    var length = totalLength * this.source.armor / this.source.properties.maxArmor;
    var lineTo = length - 159;
    
    this.lines.lineTo(lineTo, 219);
}

statusBar.prototype.drawEnergy = function() {
    //0x4B5C70 for civ
    this.lines.lineStyle(7, 0x4B5C70);
    this.lines.moveTo(-159, 237);
    this.lines.lineTo(-10, 237);
}
