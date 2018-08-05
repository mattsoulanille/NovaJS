
var destroyable = (superclass) => class extends superclass {
    constructor() {
	super(...arguments);
	this.destroyed = false;
	this._destroying = false;
	this._called_this_destroy = false;
    }

    _destroy() {
	if (super._destroy) {
	    super._destroy();
	}
	this._called_this_destroy = true;
    }

    destroy() {
	if (this.destroyed) {
	    //console.warn("Called destroy on already destroyed object");
	    return false;
	}
	if (! this._destroying) {
	    this._called_this_destroy = false;
	    this._destroying = true;
	    this._destroy();
	    if (! this._called_this_destroy) {
		console.warn("Didn't call _destroy of destroyable");
	    }
	}
	this.destroyed = true;
	this._destroying = false;
	return true;
    }
};

module.exports = destroyable;
