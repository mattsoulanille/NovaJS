"use strict";

var base = require("./base.js");

var outf = class extends base {
    constructor(resource) {
	super(...arguments);
	var d = resource.data;

	this.displayWeight = d.getInt16(0);
	this.mass = d.getInt16(2);
	this.techLevel = d.getInt16(4);
	// this.modType = d.getInt16(6);
	// this.modVal = d.getInt16(8);
	this.functions = [];

	var modPositions = [6, 18, 22, 26];
	
	for (var i in modPositions) {
	    let pos = modPositions[i];
	    let modType = d.getInt16(pos);
	    let modVal = d.getInt16(pos + 2);

	    switch (modType){
	    case 1:
		this.functions.push({"weapon" : modVal});
		break;
	    case 2:
		this.functions.push({"cargo expansion" : modVal});
		break;
	    case 3:
		this.functions.push({"ammunition" : modVal});
		break;
	    case 4:
		this.functions.push({"shield boost" : modVal});
		break;
	    case 5:
		this.functions.push({"shield recharge" : modVal});
		break;
	    case 6:
		this.functions.push({"armor boost" : modVal});
		break;
	    case 7:
		this.functions.push({"acceleration boost" : modVal});
		break;
	    case 8:
		this.functions.push({"speed increase" : modVal});
		break;
	    case 9:
		this.functions.push({"turn rate change" : modVal});
		break;
	    case 10:
		// unused
		break;
	    case 11:
		this.functions.push({"escape pod" : true});
		break;
	    case 12:
		this.functions.push({"fuel increase" : modVal});
		break;
	    case 13:
		this.functions.push({"density scanner" : true});
		break;
	    case 14:
		this.functions.push({"IFF" : true});
		break;
	    case 15:
		this.functions.push({"afterburner" : modVal});
		break;
	    case 16:
		this.functions.push({"map" : modVal});
		break;
	    case 17:
		// This will need perhaps some more parsing. There are many different cloaking device types
		this.functions.push({"cloak" : modVal});
		break;
	    case 18:
		this.functions.push({"fuel scoop" : modVal});
		break;
	    case 19:
		this.functions.push({"auto refuel" : true});
		break;
	    case 20:
		this.functions.push({"auto eject" : true});
		break;
	    case 21:
		this.functions.push({"clean legal record" : modVal});
		break;
	    case 22:
		this.functions.push({"hyperspace speed mod" : modVal});
		break;
	    case 23:
		// distance from system center
		this.functions.push({"hyperspace dist mod" : modVal});
		break;
	    case 24:
		this.functions.push({"interference mod" : modVal});
		break;
	    case 25:
		this.functions.push({"marines" : modVal});
		break;
	    case 26:
		// unused
		break;
	    case 27:
		this.functions.push({"increase maximum" : modVal});
		break;
	    case 28:
		this.functions.push({"murk modifier" : modVal});
		break;
	    case 29:
		this.functions.push({"armor recharge" : modVal});
		break;
	    case 30:
		this.functions.push({"cloak scanner" : modVal});
		break;
	    case 31:
		this.functions.push({"mining scoop" : true});
		break;
	    case 32:
		this.functions.push({"multi-jump" : modVal});
		break;
	    case 33:
		this.functions.push({"jam 1" : modVal});
		break;
	    case 34:
		this.functions.push({"jam 2" : modVal});
		break;
	    case 35:
		this.functions.push({"jam 3" : modVal});
		break;
	    case 36:
		this.functions.push({"jam 4" : modVal});
		break;
	    case 37:
		this.functions.push({"fast jump" : true});
		break;
	    case 38:
		this.functions.push({"inertial damper" : true});
		break;
	    case 39:
		this.functions.push({"ion dissipater" : modVal});
		break;
	    case 40:
		// increase ionization capacity
		this.functions.push({"ion absorber" : modVal});
		break;
	    case 41:
		this.functions.push({"gravity resistance" : true});
		break;
	    case 42:
		this.functions.push({"deadly stellar resistance" : true});
		break;
	    case 43:
		this.functions.push({"paint" : modVal});
		break;
	    case 44:
		this.functions.push({"reinforcement inhibitor" : modVal});
		break;
	    case 45:
		this.functions.push({"max guns" : modVal});
		break;
	    case 46:
		this.functions.push({"max turrets" : modVal});
		break;
	    case 47:
		this.functions.push({"bomb" : modVal});
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
    }
};


module.exports = outf;
