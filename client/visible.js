if (typeof module !== "undefined") {
    var PIXI = require("../server/pixistub.js");
}

var visible = (superclass) => class extends superclass {
    constructor() {
	super(...arguments);
	this.container = new PIXI.Container(); // Must be before call to set system
	this.container.visible = false;
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
