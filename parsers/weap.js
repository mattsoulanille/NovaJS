"use strict";

var base = require("./base.js");

var weap = class extends base {

    constructor(resource) {
	super(...arguments);
	var d = resource.data;
	this.name = resource.name;
	this.id = resource.id;

	this.reload = d.getInt16(0);
	this.duration = d.getInt16(2);
	this.armorDamage = d.getInt16(4);
	this.shieldDamage = d.getInt16(6);

	var guidance = d.getInt16(8);
	switch (guidance) {
	case -1:
	    this.guidance = 'unguided';
	    break;
	case 0:
	    this.guidance = 'beam';
	    break;
	case 1:
	    this.guidance = 'guided';
	    break;
	case 3:
	    this.guidance = 'beam turret';
	    break;
	case 4:
	    this.guidance = 'turret';
	    break;
	case 5:
	    this.guidance = 'freefall bomb';
	    break;
	case 6:
	    this.guidance = 'rocket';
	    break;
	case 7:
	    this.guidance = 'front quadrant';
	    break;
	case 8:
	    this.guidance = 'rear quadrant';
	    break;
	case 9:
	    this.guidance = 'point defence';
	    break;
	case 10:
	    this.guidance = 'point defence beam';
	    break;
	case 11:
	    this.guidance = 'bay';
	    break;
	}
    
    }    
};

module.exports = weap;
