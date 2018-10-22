// A single menu window
var PIXI = require("../server/pixistub.js");
var controllable = require("./controllable.js");
var visible = require("./visible.js");
var destroyable = require("./destroyable.js");
var loadsResources = require("./loadsResources.js");


class menu extends loadsResources(controllable(visible(destroyable(function() {})))) {

    constructor(buildInfo) {
	super(...arguments);
	this.buildInfo = buildInfo;
	
	if (typeof this.buildInfo !== 'undefined') {
	    this.background = this.data.sprite.fromPict(this.buildInfo.background);
	    
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
    
    show() {
	super.show();
	this.bindControls();
    }

    hide() {
	super.hide();
	this.unbindControls();

    }
    
    render() {
	
    }

    _destroy() {
	this.hide();
	super._destroy();
    }

}

module.exports = menu;
