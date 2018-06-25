var errors = require("../client/errors.js");
var ControlScopeError = errors.ControlScopeError;


var controllable = (superclass) => class extends superclass {
    constructor() {
	super(...arguments);
	this.boundControls = [];
	this.controls = global.gameControls;
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

	this._resetScope();
    }
    _resetScope() {
	if (this.controls.scope !== this.scope) {
	    throw new ControlScopeError("To be popped scope did not match this object's scope. Not popping");
	}
	else {
	    return this.controls.popScope();
	}
    }

};

module.exports = controllable;
