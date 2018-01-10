if (typeof(module) !== 'undefined') {
    var turretWeapon = require("../server/turretWeaponServer.js");
    var _ = require("underscore");
    var Promise = require("bluebird");
}

pointDefenseWeapon = class extends turretWeapon {
    constructor() {
	super(...arguments);
	this._enabled = false;
    }

    findNearestValid(items) {
	var get_distance = function(a, b) {
	    return Math.pow((a.position[0] - b.position[0]), 2) +
		Math.pow((a.position[1] - b.position[1]), 2);
	};
	
	var distances = {};
	items.forEach(function(t) {
	    if (t.properties.vulnerableTo.includes("point defense")) {
		var dist = get_distance(t, this.source);
		distances[dist] = t;
	    }
	}.bind(this));
	
	var min = Math.min(...Object.keys(distances));
	if (min !== Infinity) {
	    return distances[min];
	}
	else {
	    return null;
	}
    }

    get enabled() {
	return this._enabled;
    }

    set enabled(v) {
	if (v) {
	    this._enabled = true;
	    this.firing = true;
	}
	else {
	    this._enabled = false;
	    this.firing = false;
	}
    }

    
    render() {
	this.target = this.findNearestValid(this.source.targetedBy);
	
	super.render(...arguments);
	
    }
};

if (typeof(module) !== 'undefined') {
    module.exports = pointDefenseWeapon;
}
