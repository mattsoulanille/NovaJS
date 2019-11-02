
var _ = require("underscore");
var Promise = require("bluebird");
var outfit = require("../client/outfit.js");
var UUID = require('uuid/v4');

class outfitServer extends outfit{

    constructor(buildInfo) {
	super(...arguments);
    }




    // buildWeapons() {
    // 	//makes uuids for the outfit's weapons.
    // 	//assumes this.meta.functions.weapon is a list if defined
    // 	//    console.log(this.buildInfo);
    // 	this.buildInfo.UUIDS = {};
    // 	_.each(this.meta.functions.weapon, function(weaponName) {
    // 	    this.buildInfo.UUIDS[weaponName] = UUID();
    // 	}.bind(this));
    // 	/*    
    // 	      if (typeof this.meta.functions.weapon !== 'undefined') {
    // 	      this.buildInfo.UUIDS = {};
    // 	      var len = this.meta.functions.weapon.length;
    // 	      for (i = 0; i < len; i++) {
    // 	      this.buildInfo.UUIDS
    // 	      }
    // 	      }
    // 	*/
    // 	super.buildWeapons.call(this);
    // }

}
module.exports = outfitServer;
