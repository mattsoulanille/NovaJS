// A single menu window

class menu extends visible(function() {}) {

    constructor(buildInfo) {
	super(...arguments);
	this.buildInfo = buildInfo;
	
	if (typeof this.buildInfo !== 'undefined') {
	    this.background = new PIXI.Sprite.fromImage(this.buildInfo.background);
	    // So that you can't press things that are behind menus:
	    this.background.interactive = true;
	    this.background.anchor.x = 0.5;
	    this.background.anchor.y = 0.5;
	    this.container.addChild(this.background);
	    this.text = new PIXI.Text("Placeholder");
	}
	
	this.subMenus = new Set();
	this.buttons = new Set();

    }



    render() {
	
    }

    destroy() {
	this.hide();
	super.destroy();
    }

}

