var controllable = (superclass) => class extends superclass {
    constructor() {
	super(...arguments);
	this.boundControls = [];
	this.controls = gameControls;
    }

    unbindControls() {
	this.boundControls.forEach(function(f) {
	    this.controls.offAll(f);
	}.bind(this));
    }

};
