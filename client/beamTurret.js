if (typeof(module) !== 'undefined') {
    var beamWeapon = require("../server/beamWeaponServer.js");

}


beamTurret = class extends beamWeapon {
    constructor() {
	super(...arguments);
    }

    getFireAngle(position) {
	var dx = this.target.position[0] - position[0];
	var dy = this.target.position[1] - position[1];
	return Math.atan2(dy, dx);
    }
    
    render() {
	if (this.target) {
	    // can't fire without a target
	    super.render();
	}
    }

};



if (typeof(module) !== 'undefined') {
    module.exports = beamTurret;
}
