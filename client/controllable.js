var controllable = (superclass) => class extends superclass {
    constructor() {
	super(...arguments);
	this.boundControls = [];
	this.controls = gameControls;
	this.scope = null;
    }

    bindControls() {
	if (this.scope === null) {
	    throw new Error("No scope defined");
	}
	this.controls.pushScope(this.scope);
    }
    
    unbindControls() {
	this.boundControls.forEach(function(f) {
	    this.controls.offAll(f);
	}.bind(this));

	if (this.controls.popScope() !== this.scope) {
	    throw new Error("Popped scope did not match this object's scope");
	}
    }

};
