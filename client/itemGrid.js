class itemTile extends eventable(function() {}) {
    constructor(item) {
	super();
	this.item = item;
	this.boxDimensions = [83, 54];

	this.name = this.item.name;
	this.font = {
	    normal:  {fontFamily:"Geneva", fontSize:10, fill:0xffffff,
		      align:'center', wordWrap:true, wordWrapWidth:this.boxDimensions[0]},

	    grey:    {fontFamily:"Geneva", fontSize:10, fill:0x262626,
		      align:'center', wordWrap:true, wordWrapWidth:this.boxDimensions[0]},

	    count:    {fontFamily:"Geneva", fontSize:10, fill:0xffffff,
		      align:'right', wordWrap:false, wordWrapWidth:this.boxDimensions[0]}

	};

	// see the colr resource
	this.colors = {
	    dim : 0x404040,
	    bright : 0xFF0000
	};

	this.lineWidth = 1;
	this.dimStyle = [this.lineWidth, this.colors.dim];
	this.brightStyle = [this.lineWidth, this.colors.bright];


	this.graphics = new PIXI.Graphics();
	
	this.itemText = new PIXI.Text(this.name, this.font.normal);
	this.itemText.anchor.x = 0.5;
	this.itemText.position.x = this.boxDimensions[0] / 2;
	this.itemText.position.y = this.boxDimensions[1] * 1/2;

	this.quantity = 0;
	this.quantityText = new PIXI.Text("", this.font.normal);
	this.quantityText.anchor.x = 1;
	this.quantityText.position.x = this.boxDimensions[0] - 2;
	this.quantityText.position.y = 2;
	
	this.container = new PIXI.Container();
	this.container.interactive = true;
	this.active = false;
	
	this.container.on('pointerdown', function() {
	    //this.active = true;
	    this.emit("pointerdown", this);
	}.bind(this));

	this.container.addChild(this.graphics);
	this.container.addChild(this.itemText);
	this.container.addChild(this.quantityText);

    }

    draw() {
	this.graphics.clear();
	if (this.active) {
	    this.graphics.lineStyle(...this.brightStyle);
	}
	else {
	    this.graphics.lineStyle(...this.dimStyle);
	}

	this.graphics.beginFill(0x000000);
	this.graphics.drawRect(0, 0, this.boxDimensions[0], this.boxDimensions[1]);

    }
    hide() {
	this.container.visible = false;
    }
    show() {
	this.container.visible = true;
    }
    moveTo(pos) {
	this.container.position.x = pos[0];
	this.container.position.y = pos[1];
    }
    setQuantity(count) {
	this.quantity = count;
	if (this.quantity == 0) {
	    this.quantityText.text = "";
	}
	else {
	    this.quantityText.text = String(this.quantity);
	}
    }
    
}



class itemGrid {
    constructor(items) {
	this.container = new PIXI.Container();

	// Experimentally Determined
	this.boxCount = [4, 5];
	this.boxDimensions = [83, 54];

	// Make this be ships or outfits or something in the future.
	this.items = items;
	this.selectionIndex = -1;

	this.scroll = 0;

	this.makeTiles();
    }

    get selection() {
	return this.items[this.selectionIndex];
    }

    set selection(item) {
	this.selectionIndex = this.items.indexOf(item);
	this.drawGrid();
    }

    makeTiles() {
	this.tilesDict = {};
	this.tiles = this.items.map(function(item) {
	    var tile =  new itemTile(item);
	    this.container.addChild(tile.container);
	    tile.on('pointerdown', this._onTileClicked.bind(this));
	    this.tilesDict[item.id] = tile;
	    return tile;
	}.bind(this));

    }

    _onTileClicked(tile) {
	this.selectionIndex = Object.values(this.tiles).indexOf(tile);
	this.drawGrid();
    }
    
    drawGrid() {
	// Hide everything first. Reveal them later
	this.tiles.forEach(function(t) {
	    t.hide();
	});

	var start = this.boxCount[0] * this.scroll;

	let selectedPosition = null;
	for (let i = 0; i < Math.min(this.items.length - start, this.boxCount[0] * this.boxCount[1]); i++) {
	    var itemIndex = i + start;
	    var tile = this.tiles[itemIndex];
	    let xcount = i % this.boxCount[0];
	    let ycount = Math.floor(i / this.boxCount[0]);

	    tile.show();
	    if (itemIndex === this.selectionIndex) {
		tile.active = true;
		// Make sure it is above the others
		this.container.addChildAt(tile.container, this.tiles.length - 1);
	    }

	    else {
		tile.active = false;
	    }
	    
	    var pos = [xcount * this.boxDimensions[0], ycount * this.boxDimensions[1]];
	    tile.moveTo(pos);
	    tile.draw();
	}

    }

    setCounts(items) {
	// items is a list of objects that have id and count
	this.tiles.forEach(function(tile) {
	    tile.setQuantity(0);
	});

	items.forEach(function(i) {
	    this.tilesDict[i.id].setQuantity(i.count);
	}.bind(this));
    }
    
    incrementCount() {
	
    }

    decrementCount() {

    }
    
    left() {
	if (this.selectionIndex === -1) {
	    this.selectionIndex = Math.min(this.boxCount[0] * this.boxCount[1],
					   this.items.length);
	}
	else {
	    this.selectionIndex -= 1;
	    if (this.selectionIndex < 0) {
		this.selectionIndex = 0;
	    }
	}

	if (this.scroll * this.boxCount[0] > this.selectionIndex) {
	    this.scroll -= 1;
	}
	this.drawGrid();
    }
    right() {
	if (this.selectionIndex === -1) {
	    this.selectionIndex = 0;
	}
	else {
	    this.selectionIndex += 1;
	    if (this.selectionIndex > this.items.length - 1) {
		this.selectionIndex = this.items.length - 1;
	    }
	    
	}
	if (this.scroll * this.boxCount[0] +
	    this.boxCount[0] * this.boxCount[1] <= this.selectionIndex) {
	    this.scroll += 1;
	}
	this.drawGrid();
    }
    up() {
	if (this.selectionIndex === -1) {
	    this.selectionIndex = Math.min(this.boxCount[0] * this.boxCount[1],
					   this.items.length);
	}
	else if (this.selectionIndex - this.boxCount[0] >= 0) {
	    this.selectionIndex -= this.boxCount[0];
	}

	if (this.scroll * this.boxCount[0] > this.selectionIndex) {
	    this.scroll -= 1;
	}
	this.drawGrid();
    }
    down() {
	if (this.selectionIndex === -1) {
	    this.selectionIndex = 0;
	}
	else if (this.selectionIndex + this.boxCount[0] < this.items.length) {
	    this.selectionIndex += this.boxCount[0];
	}
	else {
	    this.selectionIndex = this.items.length - 1;
	}

	if (this.scroll * this.boxCount[0] +
	    this.boxCount[0] * this.boxCount[1] <= this.selectionIndex) {
	    this.scroll += 1;
	}

	this.drawGrid();
    }    
    
}



