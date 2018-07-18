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
	this.itemGrid.setCounts(global.myShip.properties.outfits);
	this._modifiedOutfits = false;
	this.itemGrid.on("tileSelected", this.setOutfitPicture.bind(this));
	
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

	this.descriptionText = new PIXI.Text("", this.font.normal);
	this.descriptionText.position.x = -27;
	this.descriptionText.position.y = -150;
	this.container.addChild(this.descriptionText);
	this.itemGrid.on("tileSelected", this.setDescription.bind(this));


    }

    buyOutfit() {
	var outfit = {id: this.itemGrid.selection.id, count:1};
	global.myShip.addOutfit(outfit, false);
	this.itemGrid.setCounts(global.myShip.properties.outfits);
	this._modifiedOutfits = true;
    }

    sellOutfit() {
	var outfit = {id: this.itemGrid.selection.id, count:1};
	global.myShip.removeOutfit(outfit, false);
	this.itemGrid.setCounts(global.myShip.properties.outfits);
	this._modifiedOutfits = true;
    }

    setOutfitPicture(outfitTile) {
	this.pictContainer.children = []; // is this legal?
	if (outfitTile.largePict) {

	    this.pictContainer.addChild(outfitTile.largePict);
	}
    }

    setDescription(outfitTile) {
	this.descriptionText.text = outfitTile.desc;
    }
    
    show() {
	this.itemGrid.setCounts(global.myShip.properties.outfits);
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
