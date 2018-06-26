var spaceObject = require("../server/spaceObjectServer.js");
var _ = require("underscore");
var spaceport = require("./spaceport.js");
//var Promise = require("bluebird");

var planet = class extends spaceObject {

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
	this.spaceport = null;
	//this.makeContainer();
    }
    
    
    
    build() {
	return super.build.call(this)
	//	.then(this.build)
	    .then(function() {
		this.system.built.planets.add(this);
		this.show();
		this.buildSpaceport();
	    }.bind(this));
    }

    
    buildSpaceport() {
	this.spaceport = new spaceport({}, this.depart.bind(this));
	global.spaceportContainer.addChild(this.spaceport.container);
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
    
    //soooo many side effects...
    land(ship) {
	if (ship.landedOn) {
	    // then it's already landed somewhere else
	    throw new Error("ship tried to land but it's already landed on " + ship.landedOn);
	}
	if (global.animate === global.animateSpaceport) {
	    throw new Error("Animate was animateSpaceport when landing");
	}
	
	var max_dist2 = Math.pow( ((this.size[0] + this.size[1]) / 4), 2 );
	var max_vel2 = 1800;

	
	var shipVel2 = ( Math.pow(ship.velocity[0], 2) + Math.pow(ship.velocity[1], 2));
	var dist2 = (Math.pow( (this.position[0] - ship.position[0]), 2) +
		     Math.pow( (this.position[1] - ship.position[1]), 2));

	
	
	if (!((shipVel2 <= max_vel2) && (dist2 <= max_dist2))) {
	    return false;
	}

	// make sure you can't land in two places at the same time
	if (animate === animateSpace) {

	    gameControls.resetEvents();

	    //this.spaceport.bindControls();
	    global.landed = true;
	    // must remember to give it back to the ship afterwards
	    global.spaceportContainer.addChild(ship.statusBar.container);
	    animate = animateSpaceport;
	    this.spaceport.show();
	    global.spaceportContainer.visible = true;
	    global.space.visible = false;
	    
	    this.socket.emit('land');
	}

	return true;
    }

    depart() {
	if (animate === animateSpace) {
	    throw new Error("Animate was animateSpace when departing");
	}
	myShip.onceState("built", function() {
	    myShip.depart(this);
	    global.space.addChild(myShip.statusBar.container);
	    gameControls.resetEvents();
	    global.landed = false;
	    animate = animateSpace;
	    requestAnimationFrame(animate);
	    //stage.addChild(space);
	    //this.spaceport.hide(); // done by spaceport.js
	    global.spaceportContainer.visible = false;
	    global.space.visible = true;
	    this.socket.emit('depart');
	}.bind(this));
    }
    
    addSpritesToContainer() {
	_.each(_.map(_.values(this.sprites), function(s) {return s.sprite;}),
	       function(s) {this.container.addChild(s);}, this);
	//this.hide();
	this.system.container.addChildAt(this.container, 0);
    }
    
};

module.exports = planet;

