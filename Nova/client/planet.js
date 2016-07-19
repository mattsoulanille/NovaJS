if (typeof(module) !== 'undefined') {
    module.exports = planet;
    spaceObject = require("./spaceObject.js");
}


function planet(name, system) {
    spaceObject.call(this, name, system);
    this.url = "objects/planets/"
}


planet.prototype = new spaceObject;


planet.prototype.build = function() {
    return spaceObject.prototype.build.call(this)
	.then(function() {
	    this.system.planets.push(this);
	}.bind(this));
    
}

planet.prototype.addSpritesToContainer = function() {
    _.each(_.map(_.values(this.sprites), function(s) {return s.sprite;}),
	   function(s) {this.spriteContainer.addChild(s);}, this);
    this.hide()

    stage.addChildAt(this.spriteContainer, 0);
}


