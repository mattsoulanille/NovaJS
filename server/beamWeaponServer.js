var beamWeapon = require("../client/beamWeapon.js");



class beamWeaponServer extends beamWeapon {

    constructor() {
	super(...arguments);
    }

//    build() {};

    render() {
	var fireAngle = this.source.pointing;
	this.renderCollisionShape(fireAngle, this.getFirePosition());
    }

    /*
    notifyServer() {
//	var stats = this.getStats();
    }
    */
    /*
    updateStats(stats) {
	if (stats.firing) {
	    this.firing = true;
	}
	else {
	    this.firing = false;
	}
	
    };
*/
}
module.exports = beamWeaponServer;
