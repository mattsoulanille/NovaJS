function statusBar(name, player) {
    this.url = "objects/statusBars/"
    this.ready = false
    this.name = name;
    this.sprites = {};
    this.spriteContainer = new PIXI.Container();
    this.targetContainer = new PIXI.Container();
    this.lines = new PIXI.Graphics();
    this.spriteContainer.addChild(this.lines);
    this.spriteContainer.addChild(this.targetContainer);
    this.source = player;
    this.text = {};
}

statusBar.prototype.build = function() {
    return this.loadResources()
	.then(_.bind(this.makeSprites, this))
	.then(_.bind(this.addSpritesToContainer, this))
	.then(this.resize.bind(this))
	.then(this.buildTargetText.bind(this))
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
	    this.sprites[key] = new sprite(this.url + this.meta.imageAssetsFiles[key], [0,0]);
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
    this.spriteContainer.position.x = $(window).width() - 194;
}

statusBar.prototype.render = function() {
    // Line positions:
    // shield: -159,202 to -10,202 width 7
    // armor:  -158,216 to -10,222
    // energy: -158,234 to -10,240

    this.lines.clear();
    this.drawShield();
    this.drawArmor();
    this.drawEnergy();
    if (this.target) {
	this.drawTarget();
	this.targetContainer.visible = true;
    }
    else {
	this.targetContainer.visible = false;
    }

    
}

statusBar.prototype.drawLine = function(dataArea, color, fullness) {
    // shield: -159,202 to -10,202 width 7

    var pos = [dataArea.position[0], dataArea.position[1]];
    var size = [dataArea.size[0], dataArea.size[1]];
    pos[1] += size[1] / 2

    this.lines.lineStyle(size[1], color);    

    this.lines.moveTo(pos[0], pos[1]);
    
    // var totalLength = 149;
    // var length = totalLength * this.source.shield / this.source.properties.maxShields;
    // var lineTo = length -159;
    
    this.lines.lineTo(pos[0] + size[0] * fullness, pos[1]);
    
}

statusBar.prototype.drawShield = function() {
    var fullness = this.source.shield / this.source.properties.maxShields;
    if (fullness < 0) { fullness = 0; }
    this.drawLine(this.meta.dataAreas.shield, this.meta.colors.shield, fullness)
}

statusBar.prototype.drawArmor = function() {
    var fullness = this.source.armor / this.source.properties.maxArmor;
    this.drawLine(this.meta.dataAreas.armor, this.meta.colors.armor, fullness)
}

statusBar.prototype.drawEnergy = function() {
    this.drawLine(this.meta.dataAreas.fuel, this.meta.colors.fuelFull, 1)
}

statusBar.prototype.drawTarget = function() {
    this.renderTargetText()
}

statusBar.prototype.buildTargetText = function() {

    var pos = [this.meta.dataAreas.targeting.position[0],
	       this.meta.dataAreas.targeting.position[1]];
    var size = [this.meta.dataAreas.targeting.size[0],
		this.meta.dataAreas.targeting.size[1]];

    var font = {font: "12px Geneva", fill:0xFFFFFF, align:'center'}
    var dimfont = {font: "12px Geneva", fill:0x888888, align:'center'}
    
    this.text.shield = new PIXI.Text('Shield:', dimfont);
    this.text.shield.anchor.y = 1;
    this.text.shield.position.x = pos[0] + 6;
    this.text.shield.position.y = pos[1] + size[1] - 3;

    this.targetContainer.addChild(this.text.shield);

    this.text.armor = new PIXI.Text('Armor:', dimfont);
    this.text.armor.anchor.y = 1;
    this.text.armor.position.x = pos[0] + 6;
    this.text.armor.position.y = pos[1] + size[1] - 3;
    this.text.armor.visible = false;
    this.targetContainer.addChild(this.text.armor);

    
    this.text.percent = new PIXI.Text("100%", font);
    this.text.percent.anchor.y = 1;
    this.text.percent.position.x = pos[0] + 49;
    this.text.percent.position.y = pos[1] + size[1] - 3;

    this.targetContainer.addChild(this.text.percent);
    
}

statusBar.prototype.renderTargetText = function() {
    if (this.target.shield > 0) {
	this.text.shield.visible = true;
	this.text.armor.visible = false;
	var shieldPercent = Math.round(100 * this.target.shield /
				       this.target.properties.maxShields) + "%";
	this.text.percent.text = shieldPercent;
    }
    else {
	this.text.shield.visible = false;
	this.text.armor.visible = true;
	var armorPercent = Math.round(100 * this.target.armor /
				      this.target.properties.maxArmor) + "%";
	this.text.percent.text = armorPercent;
    }

}

statusBar.prototype.cycleTarget = function(target) {
    // Hide old target
    if (this.targetSprite) {
	this.targetSprite.visible = false;
    }

    // Show new target
    this.target = target;
    if (target) {
	this.targetSprite = target.targetImage.sprite;

	if ( !(_.contains(this.targetContainer.children, this.targetSprite)) ) {
	    this.targetContainer.addChild(this.targetSprite)
	}

	var pos = [this.meta.dataAreas.targeting.position[0],
		   this.meta.dataAreas.targeting.position[1]];
	var size = [this.meta.dataAreas.targeting.size[0],
		    this.meta.dataAreas.targeting.size[1]];
	
	this.targetSprite.position.x = (size[0] / 2) + pos[0];
	this.targetSprite.position.y = (size[1] / 2) + pos[1];
	this.targetSprite.visible = true;

    }
    
}

