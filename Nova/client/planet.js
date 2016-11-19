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
    this.makeContainer();
}


planet.prototype = new spaceObject;

// so the server can make a fake container.
planet.prototype.makeContainer = function() {
    this.spaceportContainer = new PIXI.Container();
}

planet.prototype.build = function() {
    console.log(this.url);
    return spaceObject.prototype.build.call(this)
//	.then(this.build)
	.then(function() {
	    this.system.built.planets.push(this);
	    this.buildInfo.type = 'planet';
	    this.show();
	    this.assignControls();
	}.bind(this));
}


planet.prototype.assignControls = function() {
    gameControls.onstart("depart", this.depart.bind(this));
}

//soooo many side effects...
planet.prototype.land = function() {
    // make sure you can't land in two places at the same time
    if (animate === animateSpace) {
	gameControls.scope = gameControls.scopes.land;
	gameControls.resetEvents();
	landed = true;
	animate = animateSpaceport;
	//stage.addChild(this.spaceportContainer);
	socket.emit('land');
    }
}

planet.prototype.depart = function() {
    if (animate === animateSpaceport) {
	gameControls.scope = gameControls.scopes.space;
	gameControls.resetEvents();
	landed = false;
	animate = animateSpace;
	requestAnimationFrame(animate);
	//stage.addChild(space);
	socket.emit('depart');
    }
}

planet.prototype.addSpritesToContainer = function() {
    _.each(_.map(_.values(this.sprites), function(s) {return s.sprite;}),
	   function(s) {this.spriteContainer.addChild(s);}, this);
    this.hide();
    this.system.container.addChildAt(this.spriteContainer, 0);
}


