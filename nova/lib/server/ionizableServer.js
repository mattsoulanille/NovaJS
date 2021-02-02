var ionizable = require("../client/ionizable.js");

var ionizableServer = (superclass) => class extends ionizable(superclass) {
    constructor() {
	super(...arguments);
    }

    buildFilter() {

    }

    setColor() {
	
    }

    _setIonizationFilter(val) {};
    

};

module.exports = ionizableServer;
