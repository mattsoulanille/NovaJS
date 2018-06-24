/*
More of a dust field, really.
*/

starfield = class extends inSystem {

    constructor(source, density=0.00005, dimensions=SPACE_DIM, starname="star") {
	super(...arguments);

	this.density = density; // stars per square unit
	this.dimensions = dimensions;
	this.count = this.density * this.dimensions[0] * this.dimensions[1];

	this.stars = [];
	this.container = new PIXI.Container();
	this.starLayer = new PIXI.DisplayGroup(-10, false);
	this.container.displayGroup = this.starLayer;
	
	this.ready = false;
	this.url = 'objects/misc/';
	this.starName = starname;
	
	if (typeof(source) !== "undefined") {
	    this.attach(source);
	}
	this.built = false;
    }


    async build() {
	await this.buildStars();
	this.ready = true;
	this.built = true;

	// temporary? seems weird to have the stars connected to the system
	this.source.system.container.addChild(this.container);
	this.system.built.render.add(this);
	this.placeAll();
    }

    attach(source) {
	this.source = source;
	this.system = source.system;
	this.position = this.source.position;
	this.stars.forEach(function(s) {s.attach(source);}.bind(this));
    }

    _addToSystem() {
	
    }
    _removeFromSystem() {

    }
    
    buildStars() {

	for (var i = 0; i < this.count; i++) {
	    var s = new star(this.source, this.container, this.system);
	    this.stars.push(s);
	    this.children.add(s);
	}
	
	return Promise.all(this.stars.map(function(s) {return s.build();}));
	
    }

    placeStar(aStar) {
	//xrange and yrange are 2-element arrays
	var s = aStar;
	s.randomize();
	s.realPosition[0] = Math.random() * this.dimensions[0] - this.dimensions[0] / 2;
	s.realPosition[1] = Math.random() * this.dimensions[1] - this.dimensions[1] / 2;
	s.show();
	s.available = false;
	return true;

    }

    placeAll() {
	for (let i in this.stars) {
	    this.placeStar(this.stars[i]);
	}
    }



    render(delta) {
	/*
	this.position = _.map(this.source.position, function(n) {return n});
	if ((Math.abs(this.position[0] - this.lastPosition[0]) > this.buffer) ||
	    (Math.abs(this.position[1] - this.lastPosition[1]) > this.buffer)) {
	    
	    this.moveStars();
	    this.lastPosition = _.map(this.source.position, function(n) {return n});
	}
	*/
	
    }
}
