if (typeof(module) !== 'undefined') {
    module.exports = planet;
    var spaceObject = require("../server/spaceObjectServer.js");
    var _ = require("underscore");
    var Promise = require("bluebird");

}


function planet(buildInfo, system) {
    spaceObject.call(this, buildInfo, system);
    this.url = "objects/planets/";

    if (typeof this.buildInfo !== undefined) {
	this.landable = this.buildInfo.landable || false;
    }

    if (typeof system !== 'undefined') {
	system.planets.push(this);
    }
}


planet.prototype = new spaceObject;


planet.prototype.build = function() {
    return spaceObject.prototype.build.call(this)
	.then(function() {
	    this.system.built.planets.push(this);
	    this.buildInfo.type = 'planet';
	    this.show();
	}.bind(this));
    
}

planet.prototype.addSpritesToContainer = function() {
    _.each(_.map(_.values(this.sprites), function(s) {return s.sprite;}),
	   function(s) {this.spriteContainer.addChild(s);}, this);
    this.hide();

    space.addChildAt(this.spriteContainer, 0);
}


