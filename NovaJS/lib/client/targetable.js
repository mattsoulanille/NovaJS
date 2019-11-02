var destroyable = require("./destroyable.js");

var targetable = (superclass) => class extends destroyable(superclass) {
    constructor() {
	super(...arguments);
	this.target = null;
	this.targetedBy = new Set();
    }

    setTarget(newTarget) {
	if (this.target) {
	    this.target.targetedBy.delete(this);
	}
	
	this.target = newTarget;

	if (this.target) {
	    this.target.targetedBy.add(this);
	}
    }
    hide() {
	super.hide();
	this.setTarget(null);
	this.targetedBy.forEach(function(targeter) {
	    targeter.setTarget(null);
	});
    }
    _removeFromSystem() {
	super._removeFromSystem();
	this.setTarget(null);
    }
    
    _destroy() {
	this.setTarget(null);
	super._destroy();
    }

};

module.exports = targetable;

