var beamWeapon = require("../client/beamWeapon.js");



class beamWeaponServer extends beamWeapon {

    constructor() {
	super(...arguments);
    }

    build() {};

    startFiring() {};
    stopFiring() {};
    render() {};

    updateStats(stats) {
	if (stats.firing) {
	    this.firing = true;
	}
	else {
	    this.firing = false;
	}
	
    };
}
module.exports = beamWeaponServer;
