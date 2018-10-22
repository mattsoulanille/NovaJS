var menu = require("./menu.js");
var button = require("./button.js");
var itemGrid = require("./itemGrid.js");
var PIXI = require("../server/pixistub.js");

class shipyard extends menu {
    constructor() {
	var buildInfo = {background : "nova:8501"};
	super(buildInfo);
	this.scope = "shipyard";
	this.itemGrid = new itemGrid(global.allShips);
	this.container.addChild(this.itemGrid.container);

	this.itemGrid.drawGrid();
	this.itemGrid.container.position.x = -373;
	this.itemGrid.container.position.y = -153;

	this.buttons = {
	    Buy : new button("Buy Ship", 80, {x:-20, y:126}),
	    Done : new button("Done", 80, {x: 100, y:126})
	};


	Object.values(this.buttons).forEach(function(b) {
	    this.container.addChild(b.container);
	}.bind(this));

	this.buttons.Buy.on('press', this.buyShip.bind(this));
	this.buttons.Done.on('press', this.hide.bind(this));

	this.pictContainer = new PIXI.Container();
	this.pictContainer.position.x = 174;
	this.pictContainer.position.y = -152.5;
	this.pictContainer.scale.x = 1;
	this.pictContainer.scale.y = 1;
	this.container.addChild(this.pictContainer);

	this.itemGrid.on("tileSelected", this.setShipPicture.bind(this));
	var descWidth = 190;
	this.font = {
	    normal:  {fontFamily:"Geneva", fontSize:10, fill:0xffffff,
		      align:'left', wordWrap:true, wordWrapWidth: descWidth}
	};


	this.descriptionText = new PIXI.Text("", this.font.normal);
	this.descriptionText.position.x = -27;
	this.descriptionText.position.y = -150;
	this.container.addChild(this.descriptionText);
	this.itemGrid.on("tileSelected", this.setDescription.bind(this));

    }

    // Refactor with outfitter maybe?
    setShipPicture(shipTile) {
	this.pictContainer.children = []; // is this legal?
	if (shipTile.largePict) {
	    this.pictContainer.addChild(shipTile.largePict);
	}

    }

    setDescription(outfitTile) {
	this.descriptionText.text = outfitTile.desc;
    }

    
    buyShip() {
	// Temporary
	this.socket.emit('setShip', this.itemGrid.selection.id);
    }    

    bindControls() {
	super.bindControls();

	var c = {};
	c.depart = this.hide.bind(this);
	c.left = this.itemGrid.left.bind(this.itemGrid);
	c.up = this.itemGrid.up.bind(this.itemGrid);
	c.right = this.itemGrid.right.bind(this.itemGrid);
	c.down = this.itemGrid.down.bind(this.itemGrid);
	c.buy = this.buyShip.bind(this);

	
	this.boundControls = Object.keys(c).map(function(k) {
	    return this.controls.onStart(this.scope, k, c[k]);
	}.bind(this));
    }
}
module.exports = shipyard;
