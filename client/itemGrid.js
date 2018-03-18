class itemGrid {
    constructor(items) {
	this.container = new PIXI.Container();
	this.graphics = new PIXI.Graphics();
	//this.container.addChild(this.graphics);
	
	// see the colr resource
	this.colors = {
	    dim : 0x404040,
	    bright : 0xFF0000
	};

	this.lineWidth = 1;
	this.dimStyle = [this.lineWidth, this.colors.dim];
	this.brightStyle = [this.lineWidth, this.colors.bright];
	this.font = {
	    normal:  {fontFamily:"Geneva", fontSize:10, fill:0xffffff, align:'center'},
	    grey:    {fontFamily:"Geneva", fontSize:10, fill:0x262626, align:'center'}
	};
	
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
	// should a tile be its own class?
	
	this.tileBoarderGraphics = this.items.map(function() {
	    var g = new PIXI.Graphics();
	    return g;
	}.bind(this));

	this.tiles = this.tileBoarderGraphics.map(function(graphic) {
	    var c = new PIXI.Container();
	    c.addChild(graphic);
	    this.container.addChild(c);
	    c.interactive = true;
	    return c;
	}.bind(this));

	this.texts = this.items.map(function(item) {
	    var t = new PIXI.Text(item, this.font.normal);
	    t.anchor.x = 0.5;
	    return t;
	}.bind(this));
	
	for (let i = 0; i < this.tiles.length; i++) {
	    var tile = this.tiles[i];
	    tile.on('pointerdown', function() {
		this.selectionIndex = i;
		this.drawGrid();
		//console.log("clicked " + i);
	    }.bind(this));

	    tile.addChild(this.texts[i]);
	    this.texts[i].position.x = this.boxDimensions[0] / 2;
	    this.texts[i].position.y = this.boxDimensions[1] * 3/4;
	}


    }

    drawGrid() {
	// Hide everything first. Reveal them later
	this.tiles.forEach(function(t) {
	    t.visible = false;
	});

	var start = this.boxCount[0] * this.scroll;

	let selectedPosition = null;
	for (let i = 0; i < Math.min(this.items.length - start, this.boxCount[0] * this.boxCount[1]); i++) {
	    var itemIndex = i + start;
	    let xcount = i % this.boxCount[0];
	    let ycount = Math.floor(i / this.boxCount[0]);

	    this.tiles[itemIndex].visible = true;
	    let g = this.tileBoarderGraphics[itemIndex];
	    g.clear();
	    if (itemIndex === this.selectionIndex) {
		g.beginFill(0x000000);
		g.lineStyle(...this.brightStyle);
		g.drawRect(0, 0, this.boxDimensions[0], this.boxDimensions[1]);
		// Make sure it is above the others
		this.container.addChildAt(this.tiles[itemIndex], this.tiles.length - 1);
	    }
	    else {
		g.beginFill(0x000000);
		g.lineStyle(...this.dimStyle);
		g.drawRect(0, 0, this.boxDimensions[0], this.boxDimensions[1]);
	    }
	    this.tiles[itemIndex].position.x = xcount * this.boxDimensions[0];
	    this.tiles[itemIndex].position.y = ycount * this.boxDimensions[1];
	}

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



