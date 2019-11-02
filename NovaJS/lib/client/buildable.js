const eventable = require("../libraries/eventable.js");

var buildable = (superclass) => class extends eventable(superclass) {
    constructor() {
	super(...arguments);
	this.building = false;
	this.built = false;
    }

    async _build() {
	if (super._build) {
	    await super._build(...arguments);
	}
    }
    
    async build() {
	if (!this.building && !this.built) {
	    this.building = true;
	    await this._build();
	    this.building = false;
	    this.built = true;
	    this.emit("built");
	    this.setState("built", true);
	}
    }
};

module.exports = buildable;
