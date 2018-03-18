class shipyard extends menu {
    constructor() {
	var buildInfo = {background : "/objects/menus/shipyard.png"};
	super(buildInfo);
	this.scope = "shipyard";
	this.itemGrid = new itemGrid();
	this.container.addChild(this.itemGrid.container);

	this.itemGrid.drawGrid();
	this.itemGrid.container.position.x = -373;
	this.itemGrid.container.position.y = -153;
    }


    bindControls() {
	super.bindControls();
	this.boundControls = [
	    this.controls.onStart(this.scope, "depart", this.hide.bind(this))
	];
	
    }
    


}
