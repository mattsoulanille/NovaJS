/*
More of a dust field, really.
*/

function starfield(source, count) {

    this.stars = [];
    this.count = count || 20;
    this.ready = false;
    this.source = source;
}

starfield.prototype.build = function() {
    return this.buildStars.call(this)
	.then(function() {this.ready = true}.bind(this))
}

starfield.prototype.buildStars = function() {

    for (i = 0; i < this.count; i++) {
	var s = new star(this.source);
	this.stars.push(s);
    }


    return RSVP.all(_.map( this.stars, function(s) {s.build()}));

}

starfield.prototype.placeStar = function(xrange,yrange) {
    //xrange and yrange are 2-element arrays
        
    for (i=0; i < this.stars.length; i++) {
	var s = this.stars[i];
	if (s.available === true) {
	    s.randomize()
	    s.position[0] = Math.floor(Math.random() * (xrange[1] - xrange[0]) + xrange[0])
	    s.position[1] = Math.floor(Math.random() * (yrange[1] - yrange[0]) + yrange[0])
	    s.show()
	    s.available = false;
	    return true
	}
    }
    return false
    
    
}

starfield.prototype.placeAll = function() {
    var xsize = $(window).width()
    var ysize = $(window).height()
    var xrange = [-xsize/2, xsize/2]
    var yrange = [-ysize/2, ysize/2]

    while (this.placeStar(xrange, yrange)) {
	//pass
    }
    
}
