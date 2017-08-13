
var system = require("../client/system.js");
var _ = require("underscore");

class systemServer extends system {
    constructor() {
	super(...arguments);
    }
    
    resume() {
	var time = new Date().getTime();
	this.spaceObjects.forEach(function(s) {
	    s.lastTime = time;
	}.bind(this));
    }

    getMissingObjects(missing) {
	console.log("server is missing objects: ", missing);
    };
    
    buildPlayerShip() {
	return false;
    }
}


module.exports = systemServer;
