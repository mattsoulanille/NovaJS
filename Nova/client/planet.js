if (typeof(module) !== 'undefined') {
    module.exports = planet;
    var spaceObject = require("../server/spaceObjectServer.js");
    var _ = require("underscore");
    var Promise = require("bluebird");

}


function planet(buildInfo, system) {
    spaceObject.call(this, buildInfo, system);
    this.url = "objects/planets/";

    if (typeof this.buildInfo !== 'undefined') {
	this.landable = this.buildInfo.landable || false;
    }

    if (typeof system !== 'undefined') {
	system.planets.push(this);
    }
}


planet.prototype = new spaceObject;


planet.prototype.build = function() {
    console.log(this.url);
    return spaceObject.prototype.build.call(this)
//	.then(this.build)
	.then(function() {
	    this.system.built.planets.push(this);
	    this.buildInfo.type = 'planet';
	    this.show();
	}.bind(this));
}

planet.prototype.land = function() {
    // make sure you can't land in two places at the same time
    if (stage === space) {
	gameControls.scope = gameControls.scopes.land;
//	stage = 
	
    }
}

planet.prototype.depart = function() {
    gameControls.scope = gameControls.scopes.space;
}

planet.prototype.addSpritesToContainer = function() {
    _.each(_.map(_.values(this.sprites), function(s) {return s.sprite;}),
	   function(s) {this.spriteContainer.addChild(s);}, this);
    this.hide();

    this.system.container.addChildAt(this.spriteContainer, 0);
}


