var statusBar = class extends loadsResources(function() {}) {
    constructor(id, player) {
	super(...arguments);
	this.type = 'statusBars';
	this.id = id;
	this.ready = false;
	this.sprites = {};
	this.container = new PIXI.Container();
	// statusBar is in front of everything
	this.container.displayGroup = new PIXI.DisplayGroup(100,true);
	this.targetContainer = new PIXI.Container();
	this.lines = new PIXI.Graphics();
	this.radarContainer = new PIXI.Container();
	this.weaponsContainer = new PIXI.Container();
	

	this.container.addChild(this.lines);
	this.container.addChild(this.targetContainer);
	this.container.addChild(this.radarContainer);
	this.container.addChild(this.weaponsContainer);



	// Is this superfluous?
	this.children = new Set(); // maybe write a class for children?
	this.children.add(this.container);
	this.children.add(this.targetContainer);
	this.children.add(this.lines);
	this.children.add(this.radarContainer);
	
	this.source = player;
	this.text = {};
	if (typeof(this.source) !== 'undefined') {
	    this.system = this.source.system;
	}
    }

    async build() {
	this.meta = await this.loadResources(this.type, this.id);
	this.font = {fontFamily:"Geneva", fontSize:12, fill:this.meta.colors.brightText, align:'center'};
	this.dimFont = {fontFamily:"Geneva", fontSize:12, fill:this.meta.colors.dimText, align:'center'};
	this.makeSprites();
	this.resize(window.innerWidth, window.innerHeight);
	this.buildTargetText();
	this.buildWeaponsText();


	await this.buildTargetCorners();
	await this.buildPlanetCorners();

	this.radar = new radar(this.meta, this.source);
	this.radarContainer.position.x = this.meta.dataAreas.radar.position[0];
	this.radarContainer.position.y = this.meta.dataAreas.radar.position[1];
	this.radarContainer.addChild(this.radar.graphics);
    }

    makeSprites() {
	// revise this when you can parse PICT
	var baseImageURL = "objects/statusBars/" + this.meta.animation.pictures.statusBar;
	var baseImage = PIXI.Sprite.fromImage(baseImageURL);
	this.sprites['baseImage'] = baseImage;

	this.container.addChildAt(this.sprites['baseImage'], 0);
	space.addChild(this.container); // careful with these globals

	this.renderReady = true; 
	// how do I make sure baseImage is loaded? do I need to use
	// pixi's asset loader?
    }

    resize(width, height) {
	this.container.position.x = width - 194;
    }

    render() {
	// Line positions:
	// shield: -159,202 to -10,202 width 7
	// armor:  -158,216 to -10,222
	// energy: -158,234 to -10,240

	this.lines.clear();
	this.drawShield();
	this.drawArmor();
	this.drawEnergy();
	this.radar.render(...arguments);
	if (this.target) {
	    this.drawTarget();
	    this.targetContainer.visible = true;
	}
	else {
	    this.targetContainer.visible = false;
	}
    }

    drawLine(dataArea, color, fullness) {
	// shield: -159,202 to -10,202 width 7

	var pos = [dataArea.position[0], dataArea.position[1]];
	var size = [dataArea.size[0], dataArea.size[1]];
	pos[1] += size[1] / 2;

	this.lines.lineStyle(size[1], color);    

	this.lines.moveTo(pos[0], pos[1]);

	// var totalLength = 149;
	// var length = totalLength * this.source.shield / this.source.properties.maxShields;
	// var lineTo = length -159;

	this.lines.lineTo(pos[0] + size[0] * fullness, pos[1]);

    }

    drawShield() {
	var fullness = this.source.shield / this.source.properties.shield;
	if (fullness < 0) { fullness = 0; }
	this.drawLine(this.meta.dataAreas.shield, this.meta.colors.shield, fullness);
    }

    drawArmor() {
	var fullness = this.source.armor / this.source.properties.armor;
	this.drawLine(this.meta.dataAreas.armor, this.meta.colors.armor, fullness);
    }

    drawEnergy() {
	var full = (Math.floor(this.source.energy / 100) * 100) / this.source.properties.energy;
	var partial = (this.source.energy) / this.source.properties.energy;

	this.drawLine(this.meta.dataAreas.fuel, this.meta.colors.fuelPartial, partial);    
	this.drawLine(this.meta.dataAreas.fuel, this.meta.colors.fuelFull, full);

    }

    drawTarget() {
	this.renderTargetText();
    }

    buildWeaponsText() {
	this.weaponsContainer.position.x = this.meta.dataAreas.weapons.position[0];
	this.weaponsContainer.position.y = this.meta.dataAreas.weapons.position[1];

	this.text.noWeapon = new PIXI.Text("No Secondary Weapon", this.dimFont);
	this.text.noWeapon.anchor.x = 0.5;
	this.text.noWeapon.anchor.y = 0.5;
	this.text.noWeapon.position.x = this.meta.dataAreas.weapons.size[0] / 2;
	this.text.noWeapon.position.y = this.meta.dataAreas.weapons.size[1] / 2;;

	this.text.weapon = new PIXI.Text("", this.font);
	this.text.weapon.anchor.x = 0.5;
	this.text.weapon.anchor.y = 0.5;
	this.text.weapon.position.x = this.meta.dataAreas.weapons.size[0] / 2;
	this.text.weapon.position.y = this.meta.dataAreas.weapons.size[1] / 2;;
	
	this.weaponsContainer.addChild(this.text.noWeapon);
	this.weaponsContainer.addChild(this.text.weapon);


    }
    
    buildTargetText() {
	this.targetContainer.position.x = this.meta.dataAreas.targeting.position[0];
	this.targetContainer.position.y = this.meta.dataAreas.targeting.position[1];

	var size = [this.meta.dataAreas.targeting.size[0],
		    this.meta.dataAreas.targeting.size[1]];

	var font = this.font;
	var dimFont = this.dimFont;

	this.text.shield = new PIXI.Text('Shield:', dimFont);
	this.text.shield.anchor.y = 1;
	this.text.shield.position.x = 6;
	this.text.shield.position.y = size[1] - 3;

	this.targetContainer.addChild(this.text.shield);

	this.text.armor = new PIXI.Text('Armor:', dimFont);
	this.text.armor.anchor.y = 1;
	this.text.armor.position.x = 6;
	this.text.armor.position.y = size[1] - 3;
	this.text.armor.visible = false;
	this.targetContainer.addChild(this.text.armor);


	this.text.percent = new PIXI.Text("100%", font);
	this.text.percent.anchor.y = 1;
	this.text.percent.position.x = 49;
	this.text.percent.position.y = size[1] - 3;

	this.targetContainer.addChild(this.text.percent);

	this.text.noTarget = new PIXI.Text("No Target", dimFont);
	this.text.noTarget.anchor.y = 1;
	this.text.noTarget.position.x = 22;
	this.text.noTarget.position.y = size[1] / 2;
	// unfinished

	this.text.targetImagePlaceholder = new PIXI.Text("No target image", dimFont);
	this.text.targetImagePlaceholder.anchor.x = 0.5;
	this.text.targetImagePlaceholder.anchor.y = 0.5;

    }

    buildTargetCorners() {
	this.targetCorners = new targetCorners(this.system);
	this.children.add(this.targetCorners);
	return this.targetCorners.build();
    }

    buildPlanetCorners() {
	this.planetCorners = new targetCorners(this.system, 'planetCorners');
	this.children.add(this.planetCorners);
	return this.planetCorners.build();
    }

    renderTargetText() {
	if (this.target.shield > 0) {
	    this.text.shield.visible = true;
	    this.text.armor.visible = false;
	    var shieldPercent = Math.round(100 * this.target.shield /
					   this.target.properties.shield) + "%";
	    this.text.percent.text = shieldPercent;
	}
	else {
	    this.text.shield.visible = false;
	    this.text.armor.visible = true;
	    var armorPercent = Math.round(100 * this.target.armor /
					  this.target.properties.armor) + "%";
	    this.text.percent.text = armorPercent;
	}

    }

    setSecondary(secondary) {
	if (secondary) {
	    this.text.noWeapon.visible = false;
	    this.text.weapon.text = secondary.meta.name;
	    this.text.weapon.visible = true;
	}
	else {
	    this.text.noWeapon.visible = true;
	    this.text.weapon.visible = false;
	}
    }
    
    setTarget(target) {
	// Hide old target
	if (this.targetSprite) {
	    this.targetSprite.visible = false;
	}

	// Show new target
	this.target = target;
	if (target) {
	    if (target.targetImage) {
		this.targetSprite = target.targetImage.sprite;
	    }
	    else {
		this.targetSprite = this.text.targetImagePlaceholder;
	    }

	    if ( !(_.contains(this.targetContainer.children, this.targetSprite)) ) {
		this.targetContainer.addChild(this.targetSprite);
	    }
	    var pos = [0,0];
	    var size = [this.meta.dataAreas.targeting.size[0],
			this.meta.dataAreas.targeting.size[1]];

	    this.targetSprite.position.x = (size[0] / 2);
	    this.targetSprite.position.y = (size[1] / 2);
	    this.targetSprite.visible = true;

	    this.targetCorners.target(target);

	}
	else {
	    this.targetCorners.hide();
	}

    }


    setPlanetTarget(planetTarget) {
	if (planetTarget) {
	    this.planetCorners.target(planetTarget);
	}
	else {
	    this.planetCorners.hide();
	}

    }


    destroy() {
	this.children.forEach(function(child) {
	    child.destroy();
	});
	
    }
};
