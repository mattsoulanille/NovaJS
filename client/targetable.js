

var targetable = (superclass) => class extends superclass {
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
    
    destroy() {
	super.destroy(...arguments);
	this.setTarget(null);
    }

};


if (typeof module !== "undefined") {
    module.exports = targetable;
}
