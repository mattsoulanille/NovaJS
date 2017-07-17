"use strict";

var weap = function(resource) {
    var d = resource.data;
    var out = {};
    out.name = resource.name;
    out.id = resource.id;

    out.reload = d.getInt16(0);
    out.duration = d.getInt16(2);
    out.armorDamage = d.getInt16(4);
    out.shieldDamage = d.getInt16(6);

    var guidance = d.getInt16(8);
    switch (guidance) {
    case -1:
	out.guidance = 'unguided';
	break;
    case 0:
	out.guidance = 'beam';
        break;
    case 1:
	out.guidance = 'guided';
        break;
    case 3:
	out.guidance = 'beam turret';
        break;
    case 4:
	out.guidance = 'turret';
        break;
    case 5:
	out.guidance = 'freefall bomb';
        break;
    case 6:
	out.guidance = 'rocket';
        break;
    case 7:
	out.guidance = 'front quadrant';
        break;
    case 8:
	out.guidance = 'rear quadrant';
        break;
    case 9:
	out.guidance = 'point defence';
        break;
    case 10:
	out.guidance = 'point defence beam';
        break;
    case 11:
	out.guidance = 'bay';
        break;
    }
    
    
    


    return out;
};

module.exports = weap;
