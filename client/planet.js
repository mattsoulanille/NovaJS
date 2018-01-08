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
    land(ship) {
	if (ship.landedOn) {
	    // then it's already landed somewhere else
	    throw new error("ship tried to land but it's already landed on " + ship.landedOn);
	}
	if (animate === animateSpaceport) {
	    throw new error("Animate was animateSpaceport when landing");
	}
	
	var max_dist2 = Math.pow( ((this.size[0] + this.size[1]) / 4), 2 );
	var max_vel2 = 900;

	
	var shipVel2 = ( Math.pow(ship.velocity[0], 2) + Math.pow(ship.velocity[1], 2));
	var dist2 = (Math.pow( (this.position[0] - ship.position[0]), 2) +
		     Math.pow( (this.position[1] - ship.position[1]), 2));

	
	
	if (!((shipVel2 <= max_vel2) && (dist2 <= max_dist2))) {
	    return false;
	}

	// make sure you can't land in two places at the same time
	if (animate === animateSpace) {
	    gameControls.scope = gameControls.scopes.land;
	    gameControls.resetEvents();
	    landed = true;
	    animate = animateSpaceport;
	    //stage.addChild(this.spaceportContainer);
	    socket.emit('land');
	}

	return true;
    }

    depart() {
	if (animate === animateSpace) {
	    throw new error("Animate was animateSpace when departing");
	}
	myShip.depart(this);
	gameControls.scope = gameControls.scopes.space;
	gameControls.resetEvents();
	landed = false;
	animate = animateSpace;
	requestAnimationFrame(animate);
	//stage.addChild(space);
	socket.emit('depart');


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