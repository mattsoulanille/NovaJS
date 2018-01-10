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
    
    fire() {
	if (this.target) {
	    this.exitIndex = (this.exitIndex + 1) % this.exitPoints.length;
	    var position = this.exitPoints[this.exitIndex].position;
	    var x_diff = this.target.position[0] - position[0];
	    var y_diff = this.target.position[1] - position[1];
	    var directionToTarget = (Math.atan2(y_diff, x_diff) + 2*Math.PI) % (2*Math.PI);

	    if (this.checkBlindspots(directionToTarget)) {
		// Then it's in a blindspot and we can't fire
		return false;
	    }
	    
	    var solution = this.calcFiringSolution(position);
	    var fireAngle = solution.fireAngle;
	    var hitTime = solution.hitTime;

	    // Only fire if it will hit
	    // hitTime && hitTime <= something
	    var lifetime = this.properties.duration / 30;
	    if (hitTime <= lifetime) {
		return super.fire();

	    }
	}
	return false;
    }

    
    render() {
	this.target = this.findNearestValid(this.source.targetedBy);
	
	super.render(...arguments);
	
    }
};

if (typeof(module) !== 'undefined') {
    module.exports = pointDefenseWeapon;
}
