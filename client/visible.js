if (typeof module !== "undefined") {
    var PIXI = require("../server/pixistub.js");
    var eventable = require("../libraries/eventable.js");
}

var visible = (superclass) => class extends eventable(superclass) {
    constructor(buildInfo) {
	super(...arguments);
	this.container = new PIXI.Container(); // Must be before call to set system
	this.container.visible = false;


	if (typeof this.buildInfo !== "undefined") {
	    if (this.buildInfo.show) {
		this._onceState("built", this.show.bind(this));
	    }
	    if (this.buildInfo.visible) {
		this._onceStart("built", this.setVisible.bind(this, true));
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




if (typeof module !== "undefined") {
    module.exports = visible;
}
