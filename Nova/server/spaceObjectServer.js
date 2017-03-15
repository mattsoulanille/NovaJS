var spaceObject = require("../client/spaceObject.js");
var Promise = require("bluebird");

class spaceObjectServer extends spaceObject {

    constructor(buildInfo, system) {
	super(buildInfo, system);
	this.spriteContainer = {};
	this.spriteContainer.destroy = function() {};
    }

    loadResources() {
	return new Promise(function(fulfill, reject) {
	    var url = "../"+this.url + this.name + '.json';
	    this.meta = require(url);
	    
	    if ((typeof(this.meta) !== 'undefined') && (this.meta !== null)) {
		//console.log('fulfilling');
		fulfill();
	    }
	    else {
		reject();
	    }
	    
	    
	}.bind(this));
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
