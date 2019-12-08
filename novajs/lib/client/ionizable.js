var PIXI = require("../server/pixistub.js");


const ION_FACTOR = 0.6;

var ionizable = (superclass) => class extends superclass {
    constructor() {
	super(...arguments);
	this.ionization = 0;
	this.buildFilter();
    }

    buildFilter() {

	if (typeof this.solidContainer === "undefined") {
	    this.solidContainer = new PIXI.Container();
	    this.container.addChild(this.solidContainer);
	}

	this._ionizationFilter = new PIXI.filters.ColorMatrixFilter();
	this._ionizationFilter.resolution = window.devicePixelRatio || 1;
	this.solidContainer.filters = [this._ionizationFilter];


    }

    setColor(color) {
	// Sets the filter to the hex color 'color'
	//this._ionizationFilter.matrix = Array(20).map(Math.random);
	var rgb = PIXI.utils.hex2rgb(color);

	var normalShifted = rgb.map(function(a) {return 2*a + 1;});

	this._ionizationFilter.matrix[0] = normalShifted[0];
	this._ionizationFilter.matrix[6] = normalShifted[1];	
	this._ionizationFilter.matrix[12] = normalShifted[2];

    }

    

    _receiveCollision(other) {
	if (other.ionizationDamage) {
	    this.ionization = Math.min(this.ionization + other.ionizationDamage,
				       this.properties.ionization);
	    if (other.ionizationColor) {
		this.setColor(other.ionizationColor);
	    }
	}
	super._receiveCollision(other);
    }


    updateStats(stats) {
	super.updateStats(stats);
	if (typeof stats.ionization !== 'undefined') {
	    this.ionization = stats.ionization;
	}
    }

    getStats() {
	var stats = super.getStats.call(this);
	stats.ionization = this.ionization;
	return stats;
    }

    // ionizable must be mixed in after turnable and acceleratable.
    _getTurnRate() {
	if (this.ionized) {
	    return super._getTurnRate() * ION_FACTOR;
	}
	else {
	    return super._getTurnRate();
	}
    }
    _getAcceleration() {
	if (this.ionized) {
	    return super._getAcceleration() * ION_FACTOR;
	}
	else {
	    return super._getAcceleration();
	}
    }
    _getMaxSpeed() {
	if (this.ionized) {
	    return super._getMaxSpeed() * ION_FACTOR;
	}
	else {
	    return super._getMaxSpeed();
	}
    }


    _setIonizationFilter(val) {
	// The server has this as a no-op
	this._ionizationFilter.enabled = val;
    }
    
    render(delta) {

	// Deionize: 100 = 1 point per 30th of a second
	this.ionization = Math.max(0, this.ionization
				   - this.properties.deionize * 30/1000 * delta / 100);

	if (this.ionization > this.properties.ionization / 2) {
	    // Then we're ionized. Use the filter
	    this._setIonizationFilter(true);
	    this.ionized = true;
	}

	else {
	    this._setIonizationFilter(false);
	    this.ionized = false;
	}

	super.render(...arguments);
    }
};

module.exports = ionizable;
