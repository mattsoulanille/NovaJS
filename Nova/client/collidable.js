/*
Anything that can have collisions (with projectiles etc)
*/

if (typeof(module) !== 'undefined') {
    module.exports = collidable;
    var movable = require("../server/movableServer.js");
    var _ = require("underscore");
    var Promise = require("bluebird");
    var Crash = require("crash-colliders");

}


function collidable(buildInfo, system) {
    movable.call(this, buildInfo, system);
    if (typeof(buildInfo) !== 'undefined') {
	this.buildInfo.type = "collidable";
	if (buildInfo.hasOwnProperty('convexHulls')) {
	    this.convexHulls = buildInfo.convexHulls;
	}
    }
    if (typeof system !== 'undefined') {
	system.collidables.push(this);
    }

}

collidable.prototype = new movable;

collidable.prototype.receiveCollision = function(other) {
//	console.log(stats);

}    

collidable.prototype.crash = new Crash();
collidable.prototype.allConvexHulls = {}; 

collidable.prototype.detectCollisions = function(others) {
    // others is an array of things to check for collisions with.
    var thisXRange = [this.position[0] + this.hitbox[0][0], this.position[0] + this.hitbox[0][1]];
    var thisYRange = [this.position[1] + this.hitbox[1][0], this.position[1] + this.hitbox[1][1]];

    var rangeOverlap = function(r1, r2) {
	return (((r1[0] > r2[0]) && (r1[0] < r2[1])) ||
		((r1[1] > r2[0]) && (r1[1] < r2[1])))

    };

    var collisions = [];
    
    _.each(others, function(other) {
	
	if (_.contains(other.properties.vulnerableTo, this.properties.hits)) {
	    var otherXRange = [other.position[0] + other.hitbox[0][0],
			       other.position[0] + other.hitbox[0][1]];
	    
	    var otherYRange = [other.position[1] + other.hitbox[1][0],
			       other.position[1] + other.hitbox[1][1]];
	    
	    if (other.visible && rangeOverlap(thisXRange, otherXRange) &&
		rangeOverlap(thisYRange, otherYRange)) {
		
		collisions.push(other)
	    }
	}
    }, this);
    return collisions;

}

collidable.prototype.build = function() {
    return movable.prototype.build.call(this)
//	.then(function() {console.log(this.renderReady)}.bind(this))
	.then(collidable.prototype.makeHitbox.bind(this))
	.then(function() {
	    this.system.built.collidables.push(this)

	}.bind(this));

}

collidable.prototype.setProperties = function() {
    movable.prototype.setProperties.call(this);
    
    if (typeof(this.properties.vulnerableTo) === 'undefined') {
	this.properties.vulnerableTo = ["normal"] // normal and/or pd
    }
}


collidable.prototype.makeHitbox = function() {
    this.hitbox = [[-this.size[0]/2, this.size[0]/2],
		   [-this.size[1]/2, this.size[1]/2]];

}

collidable.prototype.destroy = function() {

    var index = this.system.collidables.indexOf(this);
    if (index !== -1) {
	this.system.collidables.splice(index, 1);
    }


    if (this.built) {
	var index = this.system.built.collidables.indexOf(this);
	if (index !== -1) {
	    this.system.built.collidables.splice(index, 1);
	}
    }

    movable.prototype.destroy.call(this);

}
