class outfitter extends menu {
    constructor() {
	var buildInfo = {background : "/objects/menus/outfitter.png"};
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
	this.buttons.Done.on('press', this.depart.bind(this));
	this.itemGrid = new itemGrid(allOutfits);
	this.container.addChild(this.itemGrid.container);

	this.itemGrid.drawGrid();
	this.itemGrid.container.position.x = -373;
	this.itemGrid.container.position.y = -153;

    }

    buyOutfit() {
	var outfit = {id: this.itemGrid.selection.id, count:1};
	myShip.addOutfit(outfit);
    }

    sellOutfit() {
	// not done yet
    }
    

    depart() {
	this.hide();
	myShip.setOutfits(myShip.properties.outfits);
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

	
	this.boundControls = Object.keys(c).map(function(k) {
	    return this.controls.onStart(this.scope, k, c[k]);
	}.bind(this));

	
    }
    


}
