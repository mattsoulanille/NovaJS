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
	super.hide();
    }
    show() {
	this.setVisible(true);
	super.show();
    }
    destroy() {
	this.container.destroy();
	super.destroy();
    }

};




if (typeof module !== "undefined") {
    module.exports = visible;
}
