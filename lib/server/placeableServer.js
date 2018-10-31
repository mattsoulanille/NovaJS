var placeable = require("../client/placeable.js");

const placeableServer = (superclass) => class extends placeable(superclass) {
    constructor() {
	super(...arguments);
    }

    _placeContainer() {}
};

module.exports = placeableServer;
