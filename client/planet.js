if (typeof(module) !== 'undefined') {
    var spaceObject = require("../server/spaceObjectServer.js");
    var _ = require("underscore");
    var Promise = require("bluebird");

}


planet = class extends spaceObject {

    constructor(buildInfo, system) {
	super(...arguments);
//	this.url = "objects/planets/";
	this.type = 'planets';

	if (typeof this.buildInfo !== 'undefined') {
	    this.landable = this.buildInfo.landable || false;
	}
	
	if (typeof system !== 'undefined') {
	    system.planets.add(this);
	}
	this.makeContainer();
    }
    
// so the server can make a fake container.
    makeContainer() {
	this.spaceportContainer = new PIXI.Container();
    }

    build() {
	return super.build.call(this)
	//	.then(this.build)
	    .then(function() {
		this.system.built.planets.add(this);
		this.show();
		this.assignControls();
	    }.bind(this));
    }


    _addToSystem() {
	if (this.built) {
	    this.system.built.planets.add(this);
	}
	this.system.planets.add(this);
	super._addToSystem.call(this);
    }
    _removeFromSystem() {
	if (this.built) {
	    this.system.built.planets.delete(this);
	}
	this.system.planets.delete(this);
	super._removeFromSystem.call(this);
    }
    
    assignControls() {
	gameControls.onstart("depart", this.depart.bind(this));
    }

//soooo many side effects...
    land() {
	/*
	// make sure you can't land in two places at the same time
	if (animate === animateSpace) {
	    gameControls.scope = gameControls.scopes.land;
	    gameControls.resetEvents();
	    landed = true;
	    animate = animateSpaceport;
	    //stage.addChild(this.spaceportContainer);
	    socket.emit('land');
	}
	*/
    }

    depart() {
	/*
	if (animate === animateSpaceport) {
	    gameControls.scope = gameControls.scopes.space;
	    gameControls.resetEvents();
	    landed = false;
	    animate = animateSpace;
	    requestAnimationFrame(animate);
	    //stage.addChild(space);
	    socket.emit('depart');
	}
	*/
    }
    
    addSpritesToContainer() {
	_.each(_.map(_.values(this.sprites), function(s) {return s.sprite;}),
	       function(s) {this.container.addChild(s);}, this);
	//this.hide();
	this.system.container.addChildAt(this.container, 0);
    }
    
}
if (typeof(module) !== 'undefined') {
    module.exports = planet;
}
