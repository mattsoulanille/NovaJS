var menu = require("./menu.js");
var button = require("./button.js");
var itemGrid = require("./itemGrid.js");

class shipyard extends menu {
    constructor() {
	var buildInfo = {background : "/objects/menus/shipyard.png"};
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
