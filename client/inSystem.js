

if (typeof(module) !== 'undefined') {
//    var Promise = require("bluebird");

}

var inSystem = class {
    constructor() {
	this.children = new Set();
	this.destroyed = false;
    }

    addChild(child) {
	if (! (child instanceof inSystem) ) {
	    Error("Child is not of type inSystem");
	}
	child.system = this.system;
	this.children.add(child);
    }

    removeChild(child) {
	this.children.delete(child);
    }

    delChild(child) {
	this.removeChild(child);
    }

    removeAllChildren() {
	this.children.clear();
    }
    
    _removeFromSystem() {
        if (this.hasOwnProperty("UUID") && this.UUID) {
            delete this.system.multiplayer[this.UUID];
	    delete this.system.built.multiplayer[this.UUID];
        }
	this.system.built.render.delete(this);

    }

    _addToSystem() {
        if (this.hasOwnProperty("UUID") && this.UUID) {
            this.system.multiplayer[this.UUID] = this;
	}
	
    }
    
    get system() {
	return this._system;
    }

    set system(sys) {

	if ((this.system !== sys) && !this.destroyed) {
	    if (this.system) {
		// remove all references of this object from system
		this._removeFromSystem();
	    }
	    this._system = sys;
	    
	    if (this.system) {
		// add this object to the system
		this._addToSystem();
		
	    }
	}
	
	this.children.forEach(function(child) {
	    child.system = this.system;
	}.bind(this));

    }
    
    destroy() {
	this.children.forEach(function(child) {
	    child.destroy();
	});
	if (this.system !== null) {
	    this.system = null;
	}
    }

    
}




if (typeof(module) !== 'undefined') {
    module.exports = inSystem;

}
