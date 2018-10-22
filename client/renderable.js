var errors = require("./errors.js");
var NoSystemError = errors.NoSystemError;
var NotBuiltError = errors.NotBuiltError;
var AlreadyRenderedError = errors.AlreadyRenderedError;
var eventable = require("../libraries/eventable.js");
var destroyable = require("./destroyable.js");

var renderable = (superclass) => class extends destroyable(eventable(superclass)) {
    constructor() {
	super(...arguments);
	this.rendered = false;
	this.delta = 0;
	this.time = 0;
    }
    
    getRendering() {
	if (! this.system) {
	    return false;
	}
	return this.system.built.render.has(this);
    }

    _addToRendering() {
	this.system.built.render.add(this);
    }
    
    setRendering(v) {

	if (! this.system) {
	    throw new NoSystemError("Tried to set rendering but object has no system to render with");
	}
	if (! this.built) {
	    throw new NotBuiltError("Can't change rendering of an unbuilt object");
	}

	if (v) {
	    // var rendered = this.rendered;
	    // this.rendered = false;
	    // this.render(0); // update all the stuff before showing it
	    // this.rendered = rendered;
	    this._addToRendering();
	}
	else {
	    this.system.built.render.delete(this);
	}
    }

    hide() {
	this.setRendering(false);
	if (super.hide) {
	    super.hide();
	}
    }
    show() {
	this.setRendering(true);
	this.lastTime = this.time;
	if (super.show) {
	    this.once("rendered", super.show.bind(this));
	    //super.show();
	    // Don't show it immediately. Show it right after rendering one frame.
	}

    }
    render(delta, time) {
	this.lastTime = this.time;
	if (time) {
	    this.time = time;
	}
	else {
	    this.time += delta;
	}

	this.delta = delta; // for beam weapons and other things
	if (this.rendered) {
	    throw new AlreadyRenderedError("Object has already been rendered this frame");
	}
	this.rendered = true;
	this.emit("rendered");

    }
    _destroy() {
	if (this.system) {
	    this.hide();
	}
	super._destroy();
	this.render = this.hide = this.show = function() {
	    throw new Error("Called method of destroyed object");
	};
    }

    
};

module.exports = renderable;

