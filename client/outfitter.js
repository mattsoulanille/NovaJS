class outfitter extends menu {
    constructor() {
	var buildInfo = {background : "/objects/menus/outfitter.png"};
	super(buildInfo);
	this.scope = "outfitter";

	this.buttons = {
	    Buy : new button("Buy", 80, {x:-20, y:126}),
	    Done : new button("Done", 80, {x: 100, y:126})
	};

	Object.values(this.buttons).forEach(function(b) {
	    this.container.addChild(b.container);
	}.bind(this));

	
	this.buttons.Done.on('press', this.hide.bind(this));
    }


    bindControls() {
	super.bindControls();
	this.boundControls = [
	    this.controls.onStart(this.scope, "depart", this.hide.bind(this))
	];
	
    }
    


}
