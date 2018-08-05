var stringFormat = require("./stringFormat.js");
var menu = require("./menu.js");
var button = require("./button.js");
var itemGrid = require("./itemGrid.js");
var PIXI = require("../server/pixistub.js");

class outfitter extends menu {
    constructor() {
	var buildInfo = {background : "/objects/picts/nova:8502.png"};
	super(buildInfo);
	this.scope = "outfitter";

	this.buttons = {
	    Buy : new button("Buy", 60, {x:-100, y:126}),
	    Sell : new button("Sell", 60, {x:0, y:126}),
	    Done : new button("Done", 60, {x: 100, y:126})
	};

	Object.values(this.buttons).forEach(function(b) {
	    this.container.addChild(b.container);
	}.bind(this));


	this.buttons.Buy.on('press', this.buyOutfit.bind(this));
	this.buttons.Sell.on('press', this.sellOutfit.bind(this));
	this.buttons.Done.on('press', this.depart.bind(this));
	
	this.itemGrid = new itemGrid(global.allOutfits);
	this.container.addChild(this.itemGrid.container);

	this.itemGrid.drawGrid();
	this.itemGrid.container.position.x = -373;
	this.itemGrid.container.position.y = -153;
	this._modifiedOutfits = false;
	
	this.pictContainer = new PIXI.Container();
	this.pictContainer.position.x = 174;
	this.pictContainer.position.y = -152.5;
	this.pictContainer.scale.x = 1;
	this.pictContainer.scale.y = 1;
	this.container.addChild(this.pictContainer);


	// Refactor this
	var descWidth = 190;
	this.font = {
	    normal:  {fontFamily:"Geneva", fontSize:10, fill:0xffffff,
		      align:'left', wordWrap:true, wordWrapWidth: descWidth},

	    grey:    {fontFamily:"Geneva", fontSize:10, fill:0x262626,
		      align:'left', wordWrap:true, wordWrapWidth:descWidth},

	    count:    {fontFamily:"Geneva", fontSize:10, fill:0xffffff,
		       align:'right', wordWrap:false, wordWrapWidth:descWidth}

	};

	this.text = {};
	this.text.description = new PIXI.Text("", this.font.normal);
	this.text.description.position.x = -27;
	this.text.description.position.y = -150;



	this.text.itemPrice = new PIXI.Text("Item Price:", this.font.normal);
	this.text.itemPrice.position.x = 234;
	this.text.itemPrice.position.y = 58;
	this.text.price = new PIXI.Text("5,000 cr", this.font.normal);
	this.text.price.position.x = 300;
	this.text.price.position.y = 58;
	
	this.text.youHave = new PIXI.Text("You Have:", this.font.normal);
	this.text.youHave.position.x = 234;
	this.text.youHave.position.y = 70;
	this.text.count = new PIXI.Text("4", this.font.normal);
	this.text.count.position.x = 300;
	this.text.count.position.y = 70;
	
	this.text.itemMass = new PIXI.Text("Item Mass:", this.font.normal);
	this.text.itemMass.position.x = 234;
	this.text.itemMass.position.y = 94;
	this.text.mass = new PIXI.Text("3", this.font.normal);
	this.text.mass.position.x = 300;
	this.text.mass.position.y = 94;

	this.text.availableMass = new PIXI.Text("Available:", this.font.normal);
	this.text.availableMass.position.x = 234;
	this.text.availableMass.position.y = 106;
	this.text.freeMass = new PIXI.Text("", this.font.normal);
	this.text.freeMass.position.x = 300;
	this.text.freeMass.position.y = 106;


	this.itemGrid.on("tileSelected", this.setOutfitSelected.bind(this));

	
	
	//Object.values(this.text).forEach(this.container.addChild);
	Object.values(this.text).forEach(function(t) {
	    this.container.addChild(t);
	}.bind(this));
    }

    buyOutfit() {
	var mass = this.itemGrid.selection.mass;
	if (mass <= global.myShip.properties.freeMass) {
	    var outfit = {id: this.itemGrid.selection.id, count:1};
	    global.myShip.addOutfit(outfit, false);
	    global.myShip.properties.freeMass -= mass;
	    this.setFreeMassText();
	    this.itemGrid.setCounts(global.myShip.properties.outfits);
	    this._modifiedOutfits = true;
	}
    }

    sellOutfit() {
	var outfit = {id: this.itemGrid.selection.id, count:1};
	if (global.myShip.removeOutfit(outfit, false)) {
	    global.myShip.properties.freeMass += this.itemGrid.selection.mass;	    
	}
	this.setFreeMassText();
	this.itemGrid.setCounts(global.myShip.properties.outfits);
	this._modifiedOutfits = true;
    }

    setOutfitSelected(outfitTile) {
	// Set Picture
	this.pictContainer.children = []; // is this legal?
	if (outfitTile.largePict) {

	    this.pictContainer.addChild(outfitTile.largePict);
	}

	// Set Description
	this.text.description.text = outfitTile.desc;

	// Set price text
	this.text.price.text = stringFormat.formatPrice(outfitTile.item.price);
	
	if (outfitTile.item.mass > 0) {
	    // Set mass text
	    this.text.mass.text = outfitTile.item.mass + " tons";
	    this.setFreeMassText();
	    this.text.mass.visible = true;
	    this.text.itemMass.visible = true;
	    this.text.availableMass.visible = true;
	    this.text.freeMass.visible = true;
	}
	else {
	    this.text.mass.visible = false;
	    this.text.itemMass.visible = false;
	    this.text.availableMass.visible = false;
	    this.text.freeMass.visible = false;
	}	
    }

    setFreeMassText() {
	this.text.freeMass.text = stringFormat.formatMass(global.myShip.properties.freeMass);
    }

    show() {
	this.itemGrid.setCounts(global.myShip.properties.outfits);
	this.setFreeMassText();
	super.show();
    }
    
    depart() {
	this.hide();
	if (this._modifiedOutfits) {
	    global.myShip.setOutfits();
	}
	this._modifiedOutfits = false;
    }
    
    bindControls() {
	super.bindControls();

	var c = {};
	c.depart = this.depart.bind(this);
	c.left = this.itemGrid.left.bind(this.itemGrid);
	c.up = this.itemGrid.up.bind(this.itemGrid);
	c.right = this.itemGrid.right.bind(this.itemGrid);
	c.down = this.itemGrid.down.bind(this.itemGrid);
	c.buy = this.buyOutfit.bind(this);
	c.sell = this.sellOutfit.bind(this);
	
	this.boundControls = Object.keys(c).map(function(k) {
	    return this.controls.onStart(this.scope, k, c[k]);
	}.bind(this));

	
    }
}
module.exports = outfitter;
