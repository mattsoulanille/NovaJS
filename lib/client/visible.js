var destroyable = require("./destroyable.js");
var PIXI = require("../server/pixistub.js");
var eventable = require("../libraries/eventable.js");


var visible = (superclass) => class extends destroyable(eventable(superclass)) {
    constructor(buildInfo) {
	super(...arguments);
	this.container = new PIXI.Container(); // Must be before call to set system
	this.container.visible = false;


	if (typeof buildInfo !== "undefined") {
	    if (buildInfo.show) {
		this.onceState("built", this.show.bind(this));
	    }
	    if (buildInfo.visible) {
		this.onceState("built", this.setVisible.bind(this, true));
	    }
	}
    }

    getVisible() {
	return this.container.visible;
    }

    setVisible(v) {
	this.container.visible = Boolean(v);
    }

    _addToSystem() {
	super._addToSystem();
	//this._addToContainer();
    }

    _removeFromSystem() {
	super._removeFromSystem();
	//super._removeFromContainer();
    }

    _addToContainer() {
	this.system.container.addChild(this.container);
    }

    _removeFromContainer() {
	this.system.container.removeChild(this.container);
    }
    
    hide() {
	this.setVisible(false);
	if (super.hide) {
	    super.hide();
	}
    }
    show() {
	this.setVisible(true);
	if (super.show) {
	    super.show();
	}
    }
    _destroy() {
	this.container.destroy();
	super._destroy();
    }
};

module.exports = visible;

