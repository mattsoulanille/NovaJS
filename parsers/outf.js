"use strict";

var base = require("./base.js");

var outf = class extends base {
    constructor(resource) {
	super(...arguments);
	var d = resource.data;

	this.displayWeight = d.getInt16(0);
	this.mass = d.getInt16(2);
	this.techLevel = d.getInt16(4);
	this.modType = d.getInt16(6);
	this.modVal = d.getInt16(8);
	this.functions = [];

	var i = 0;

	switch (this.modType){
	case 1:
	    this.functions.push({"weapon" : this.modVal});
	    break;
	case 2:
	    this.functions.push({"cargo expansion" : this.modVal});
	    break;
	case 3:
	    this.functions.push({"ammunition" : this.modVal});
	    break;
	case 4:
	    this.functions.push({"shield boost" : this.modVal});
	    break;
	case 5:
	    this.functions.push({"shield recharge" : this.modVal});
	    break;
	case 6:
	    this.functions.push({"armor boost" : this.modVal});
	    break;
	case 7:
	    this.functions.push({"acceleration boost" : this.modVal});
	    break;
	case 8:
	    this.functions.push({"speed increase" : this.modVal});
	    break;
	case 9:
	    this.functions.push({"turn rate change" : this.modVal});
	    break;
	case 10:
	    // unused
	    break;
	case 11:
	    this.functions.push({"escape pod" : true});
	    break;
	case 12:
	    this.functions.push({"fuel increase" : this.modVal});
	    break;
	case 13:
	    this.functions.push({"density scanner" : true});
	    break;
	case 14:
	    this.functions.push({"IFF" : true});
	    break;
	case 15:
	    this.functions.push({"afterburner" : this.modVal});
	    break;
	case 16:
	    this.functions.push({"map" : this.modVal});
	    break;
	case 17:
	    // This will need perhaps some more parsing. There are many different cloaking device types
	    this.functions.push({"cloak" : this.modVal});
	    break;
	case 18:
	    this.functions.push({"fuel scoop" : this.modVal});
	    break;
	case 19:
	    this.functions.push({"auto refuel" : true});
	    break;
	case 20:
	    this.functions.push({"auto eject" : true});
	    break;
	case 21:
	    this.functions.push({"clean legal record" : this.modVal});
	    break;
	case 22:
	    this.functions.push({"hyperspace speed mod" : this.modVal});
	    break;
	case 23:
	    // distance from system center
	    this.functions.push({"hyperspace dist mod" : this.modVal});
	    break;
	case 24:
	    this.functions.push({"interference mod" : this.modVal});
	    break;
	case 25:
	    this.functions.push({"marines" : this.modVal});
	    break;
	case 26:
	    // unused
	    break;
	case 27:
	    this.functions.push({"increase maximum" : this.modVal});
	    break;
	case 28:
	    this.functions.push({"murk modifier" : this.modVal});
	    break;
	case 29:
	    this.functions.push({"armor recharge" : this.modVal});
	    break;
	case 30:
	    this.functions.push({"cloak scanner" : this.modVal});
	    break;
	case 31:
	    this.functions.push({"mining scoop" : true});
	    break;
	case 32:
	    this.functions.push({"multi-jump" : this.modVal});
	    break;
	case 33:
	    this.functions.push({"jam 1" : this.modVal});
	    break;
	case 34:
	    this.functions.push({"jam 2" : this.modVal});
	    break;
	case 35:
	    this.functions.push({"jam 3" : this.modVal});
	    break;
	case 36:
	    this.functions.push({"jam 4" : this.modVal});
	    break;
	case 37:
	    this.functions.push({"fast jump" : true});
	    break;
	case 38:
	    this.functions.push({"inertial damper" : true});
	    break;
	case 39:
	    this.functions.push({"ion dissipater" : this.modVal});
	    break;
	case 40:
	    // increase ionization capacity
	    this.functions.push({"ion absorber" : this.modVal});
	    break;
	case 41:
	    this.functions.push({"gravity resistance" : true});
	    break;
	case 42:
	    this.functions.push({"deadly stellar resistance" : true});
	    break;
	case 43:
	    this.functions.push({"paint" : this.modVal});
	    break;
	case 44:
	    this.functions.push({"reinforcement inhibitor" : this.modVal});
	    break;
	case 45:
	    this.functions.push({"max guns" : this.modVal});
	    break;
	case 46:
	    this.functions.push({"max turrets" : this.modVal});
	    break;
	case 47:
	    this.functions.push({"bomb" : this.modVal});
	    break;
	case 48:
	    this.functions.push({"iff scrambler" : true});
	    break;
	case 49:
	    this.functions.push({"repair system" : true});
	    break;
	case 50:
	    this.functions.push({"nonlethal bomb" : true});
	    break;
	default:
	    break;
	}
    }
};


module.exports = outf;
