if (typeof(module) !== 'undefined') {
    var beamWeapon = require("../server/beamWeaponServer.js");

}


beamTurret = class extends beamWeapon {
    constructor() {
	super(...arguments);
	this._fireFunc = null;
	this._stopFunc = null;
    }

    getFireAngle(position) {
	// Maybe refactor this so you don't plug it into sine and cosine in beamWeapon.js
	var dx = this.target.position[0] - position[0];
	var dy = this.target.position[1] - position[1];
	return Math.atan2(dy, dx);
    }

    startFiring(notify = true) {

	var stop = super.stopFiring.bind(this, notify);
	this._stopFunc = function() {
	    // If we stopped firing, then we need
	    // to start again if something is targeted
	    this.onceState("hasTarget", this._fireFunc, true);
	    stop();
	}.bind(this);


	var fire = super.startFiring.bind(this, notify);
	this._fireFunc = function() {
	    // If we started firing, then we need
	    // to stop again if there is no target
	    this.onceState("hasTarget", this._stopFunc, false);	    
	    fire();
	}.bind(this);

	this.onceState("hasTarget", this._fireFunc, true);

    }

    stopFiring(notify = true) {
	this.offState("hasTarget", this._fireFunc, true);
	this.offState("hasTarget", this._stopFunc, false);
	super.stopFiring(notify);
    }
    
};



if (typeof(module) !== 'undefined') {
    module.exports = beamTurret;
}
