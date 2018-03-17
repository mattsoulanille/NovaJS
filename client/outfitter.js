class outfitter extends menu {
    constructor() {
	var buildInfo = {background : "/objects/menus/outfitter.png"};
	super(buildInfo);
	this.scope = "outfitter";
    }


    bindControls() {
	super.bindControls();
	this.boundControls = [
	    this.controls.onStart(this.scope, "depart", this.hide.bind(this))
	];
	
    }
    


}
