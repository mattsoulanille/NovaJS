class itemGrid {
    constructor() {
	this.container = new PIXI.Container();
	this.graphics = new PIXI.Graphics();
	this.container.addChild(this.graphics);
	
	// see the colr resource
	this.colors = {
	    dim : 0x404040,
	    bright : 0xFF0000
	};

	this.lineWidth = 1;
	this.dimStyle = [this.lineWidth, this.colors.dim];
	this.brightStyle = [this.lineWidth, this.colors.bright];
	
	// Experimentally Determined
	this.boxCount = [4, 5];
	this.boxDimensions = [83, 54];

	this.items = ["doot", "deet", "foo", "bar", "change", "this", "to", "real", "items", "later",1,2,3,4,5,6,7,7,8,1,4,5,6,7,8,8];
	this.selectionIndex = null;
    }


    drawGrid() {
	
	for (let i = 0; i < Math.min(this.items.length, this.boxCount[0] * this.boxCount[1]); i++) {
	    let xcount = i % this.boxCount[0];
	    let ycount = Math.floor(i / this.boxCount[0]);
	    
	    if (i === this.selectionIndex) {
		this.graphics.lineStyle(...this.brightStyle);
	    }
	    else {
		this.graphics.lineStyle(...this.dimStyle);
	    }

	    this.graphics.drawRect(xcount * this.boxDimensions[0],
				   ycount * this.boxDimensions[1],
				   this.boxDimensions[0],
				   this.boxDimensions[1]);
	    
	}
	
    }
    
}
