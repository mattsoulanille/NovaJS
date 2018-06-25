
var PIXI = require("../server/pixistub.js");
var eventable = require("../libraries/eventable.js");


var visible = (superclass) => class extends eventable(superclass) {
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
    destroy() {
	this.container.destroy();
	if (super.destroy) {
	    super.destroy();
	}
    }
};

module.exports = visible;

