var position = require("./position.js");

const placeable = (superclass) => class extends superclass {
    constructor() {
	super(...arguments);
	this.position = new position(0, 0);
    }


    render() {
	super.render(...arguments);
	this._placeContainer();
    }

    _placeContainer() {
	if (this.container && !this.isPlayerShip) {
	    var stagePosition = this.position.getStagePosition();
	    this.container.position.x = stagePosition[0];
	    this.container.position.y = stagePosition[1];
	}

    }

};

module.exports = placeable;
