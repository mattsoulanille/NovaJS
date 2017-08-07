var spaceObject = require("../client/spaceObject.js");
var Promise = require("bluebird");

class spaceObjectServer extends spaceObject {

    constructor(buildInfo, system) {
	super(buildInfo, system);
	this.spriteContainer = {};
	this.spriteContainer.destroy = function() {};
    }

    makeSize() {
	// fix me later
	this.size[0] = 72;
	this.size[1] = 72;
    }


    addSpritesToContainer() {
	// do nothing
    }

    callSprites(call) {
    // also do nothing
    }
    
    render() {
	// again, do nothing
    }
/*
spaceObjectServer.prototype.destroy = function() {
    var index;
    if (this.built) {
	index = this.system.built.spaceObjects.indexOf(this);
	this.system.spaceObjects.splice(index, 1);
    }

    index = this.system.spaceObjects.indexOf(this);
    this.system.spaceObjects.splice(index, 1);

}

    
*/
}
module.exports = spaceObjectServer;
