

if (typeof(module) !== 'undefined') {
//    var Promise = require("bluebird");

}

var inSystem = class {
    constructor() {
	this.children = new Set();
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

    }

    _addToSystem() {
	
    }
    
    get system() {
	return this._system;
    }

    set system(sys) {

	if (this.system !== sys) {
	    if ((this.system !== undefined)) {
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

}




if (typeof(module) !== 'undefined') {
    module.exports = inSystem;

}
