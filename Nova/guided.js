function guided(projName, meta, source) {
    projectile.call(this, projName, meta, source);


}

guided.prototype = new projectile;




guided.prototype.render = function() {
    if (this.target) {
	this.turnToTarget();
    }
    
    projectile.prototype.render.call(this);
    
    

}
    
guided.prototype.turnToTarget = function() {
    var x_diff = this.target.position[0] - this.position[0];
    var y_diff = this.target.position[1] - this.position[1];
    
    var directionToTarget = (Math.atan2(y_diff, x_diff) + 2*Math.PI) % (2*Math.PI);


    this.turnTo(directionToTarget);
    //console.log(directionToTarget);

}


guided.prototype.fire = function(direction, position, velocity, target) {
    var factor = 30/100;
    this.polarVelocity = this.meta.physics.speed * factor;
    projectile.prototype.fire.call(this, direction, position, velocity, target);
}

guided.prototype.end = function() {
    this.polarVelocity = 0;
    this.turning = "";
    projectile.prototype.end.call(this);
}
