var beamWeapon = require("../server/beamWeaponServer.js");

var pointDefenseBeam = class extends beamWeapon {
    constructor() {
	super(...arguments);
	this._enabled = false;

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

    getFireVector(position) {
	// needed since this is the vector of the beam, not the destination point
	var start = this.getFirePosition(); 
	var end = this.target.position;
	return [end[0] - start[0], end[1] - start[1]];
    }
    
    // Copied from pointDefenseWeapon. Refactor?
    findNearestValid(items, maxDistance) {
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
	if ( (min !== Infinity) && (min <= maxDistance ** 2) ) {
	    return distances[min];
	}
	else {
	    return null;
	}
    }

    setTarget() {
	// Target can't be set. it's determined by the closest projectile
    }

    
    render() {
	var previous = this.target;
	var nearest = this.findNearestValid(this.source.targetedBy,
					    this.meta.animation.beamLength);
	super.setTarget(nearest);
	if (this.target) {
	    this.setVisible(true);
	    super.render();
	}
	else if (previous !== null) {
	    this.setVisible(false);
	}
	
    }
    _clearGraphics() {
	this.graphics.clear();
    }

};
module.exports = pointDefenseBeam;

