/*
Anything that can have collisions (with projectiles etc)
*/

function collidable(name) {
    movable.call(this, name);

    // assumes all textures of a PIXI sprite are the same size


}

collidable.prototype = new movable;

collidable.prototype.receiveCollision = function(other) {

}    


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
	var otherXRange = [other.position[0] + other.hitbox[0][0],
			   other.position[0] + other.hitbox[0][1]];

	var otherYRange = [other.position[1] + other.hitbox[1][0],
			   other.position[1] + other.hitbox[1][1]];
	
	if (other.visible && rangeOverlap(thisXRange, otherXRange) &&
	    rangeOverlap(thisYRange, otherYRange)) {

	    collisions.push(other)
	}
    }, this);
    return collisions;

}

collidable.prototype.build = function() {
    return movable.prototype.build.call(this)
//	.then(function() {console.log(this.renderReady)}.bind(this))
	.then(collidable.prototype.makeHitbox.bind(this));

}
collidable.prototype.makeHitbox = function() {


    // assumes all textures are the same size per sprite
    var maxX = _.max(_.map(this.sprites, function(spr) {
	return spr.textures[0]._frame.width;
    }, this))

    
    var maxY = _.max(_.map(this.sprites, function(spr) {
	return spr.textures[0]._frame.height;
    }, this))

    this.hitbox = [[-maxX/2, maxX/2],
		   [-maxY/2, maxY/2]];

}
