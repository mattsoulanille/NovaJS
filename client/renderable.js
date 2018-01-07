if (typeof module !== "undefined") {
    var errors = require("./errors.js");
    var NoSystemError = errors.NoSystemError;
    var NotBuiltError = errors.NotBuiltError;
}

var renderable = (superclass) => class extends superclass {
    constructor() {
	super(...arguments);
	this.rendered = false;
    }
    
    getRendering() {
	if (! this.system) {
	    return false;
	}
	return this.system.built.render.has(this);
    }
    setRendering(v) {

	if (! this.system) {
	    throw new NoSystemError("Tried to set rendering but object has no system to render with");
	}
	if (! this.built) {
	    throw new NotBuiltError("Can't change rendering of an unbuilt object");
	}

	if (v) {
	    this.system.built.render.add(this);
	}
	else {
	    this.system.built.render.delete(this);
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
	this.setRendering(false);
    }
    show() {
	this.setVisible(true);
	this.setRendering(true);
	this.lastTime = this.time;	
    }
    render() {
	if (this.rendered) {
	    throw new Error("Object has already been rendered this frame");
	}
	this.rendered = true;
    }
};
if (typeof module !== "undefined") {
    module.exports = renderable;
}
