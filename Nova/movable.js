/*
movable.js
Handles any space object that moves



*/


function movable(name) {
    spaceObject.call(this, name);
    this.velocity = [0,0];


}

movable.prototype = new spaceObject;




movable.prototype.setProperties = function() {
    // seems a bit insane: inserts a promise into the
    // spaceObject.prototype.loadResources promise chain
    spaceObject.prototype.setProperties.call(this)




}

movable.prototype.render = function() {
    if (this.renderReady) {
	

	if (typeof this.lastTime != 'undefined') {
	    this.position[0] += this.velocity[0] * (this.time - this.lastTime)/1000
	    this.position[1] += this.velocity[1] * (this.time - this.lastTime)/1000
	    
	}
	this.lastTime = this.time;
//	this.previousMoveTime = this.time
	spaceObject.prototype.render.call(this)
	return true
    }
    else {
	return false
    }

}
