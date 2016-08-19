module.exports = collidableServer;
var collidable = require("../client/collidable.js");
var _ = require("underscore");
var Promise = require("bluebird");
var fs = require('fs');
var PNG = require('pngjs').PNG;
var hull = require('./hull.js');

function collidableServer(buildInfo, system) {
    collidable.call(this, buildInfo, system);
}

collidableServer.prototype = new collidable;

// stops the server from sending bogus updateStats events
collidableServer.prototype.receiveCollision = function(other) {}

collidableServer.prototype.build = function() {
    return collidable.prototype.build.call(this)
	.then(function() {
	    return new Promise(function(fulfill, reject) {
		if ( !(collidable.prototype.allConvexHulls.hasOwnProperty(this.url + this.name)) ) {
		    collidable.prototype.allConvexHulls[this.url + this.name] = this.setConvexHulls();
		}

		collidable.prototype.allConvexHulls[this.url + this.name]
		    .then(function(data) {
			this.convexHulls = data.hulls;
			this.collisionSpriteName = data.collisionSpriteName;
			fulfill();
		    }.bind(this));
	    }.bind(this));
	}.bind(this))
	.then(function() {
//	    this.buildInfo.convexHulls = this.convexHulls;
//	    this.buildInfo.collisionSpriteName = this.collisionSpriteName;

	}.bind(this));
//	.then(function() {console.log(this.convexHulls)}.bind(this));
//	.then(collidableServer.prototype.loadImage.bind(this))
//	.then(collidableServer.prototype.makeConvexHulls.bind(this))
//	.then(function(v) {console.log(v[0]);})

}


collidableServer.prototype.setConvexHulls = function() {
    return new Promise(function(fulfill, reject) {
	this.loadImage()
	    .then(this.makeConvexHulls.bind(this))
	    .then(function(data) {
		fulfill(data);
	    }.bind(this))
//	fulfill("test hulls " + this.url + this.name);

    }.bind(this));
}

collidableServer.prototype.makeConvexHulls = function(pixelArray) {
//    console.log(this.collisionSprite);
    var points_array = _.map(this.collisionSprite.spriteImageInfo.frames, function(v) {
	//	console.log(v.frame);
	var xStart = v.frame.x;
	var yStart = v.frame.y;
	var width = v.frame.w;
	var height = v.frame.h;
	var origin = [this.collisionSprite.anchor[0] * width + xStart,
		      this.collisionSprite.anchor[1] * height + yStart];

	var points = [];
	for (var y = yStart; y < (height + yStart); y++) {
	    for (var x = xStart; x < (width + xStart); x++) {
		if (pixelArray[y][x] === true) {
		    // -y since down is positive on the picture
		    points.push([x - origin[0], -(y - origin[1])]); 
		}
	    }
	}
	return points;

    }.bind(this));

    var convex_hulls = _.map(points_array, function(points) {
	return hull(points);
    });

    var data = {"hulls":convex_hulls,
		"collisionSpriteName":this.collisionSpriteName
	       }
    return data;

}

// todo: only send convex hull to client if client doesn't have it yet...
// maybe client requests it
collidableServer.prototype.loadImage = function() {
    return new Promise(function(fulfill, reject) {
	// fix this. it's a bit hard wired...
	// maybe specify a collision image (which image to use for collisions) in properties?
	
	if (_.size(this.sprites) === 1) {
	    var key = _.keys(this.sprites)[0];
	    this.collisionSprite = this.sprites[key];
	    this.collisionSpriteName = key;
//	    console.log(this.collisionSpriteName);
	    
	}
	else if (this.sprites.hasOwnProperty('ship')) {
	    this.collisionSprite = this.sprites['ship'];
	    this.collisionSpriteName = 'ship';
	}
	else {
	    reject("no collision image");
	    return;
	}
	var imageURL = './' + this.url + this.collisionSprite.spriteImageInfo.meta.image;


	//console.log(imageURL);
	fs.createReadStream(imageURL)
	    .pipe(new PNG({
		filterType: 4
	    }))
	    .on('parsed', function() {
		var alpha_matrix = [];
		for (var y = 0; y < this.height; y++) {
		    var alpha_row = [];
		    for (var x = 0; x < this.width; x++) {
			var idx = (this.width * y + x) << 2;
			
			// invert color
			// this.data[idx] = 255 - this.data[idx];
			// this.data[idx+1] = 255 - this.data[idx+1];
			// this.data[idx+2] = 255 - this.data[idx+2];
			
			// and reduce opacity
			//this.data[idx+3] = 0;
			if (this.data[idx+3] === 255) {
			    alpha_row[x] = true;
			}
			else {
			    alpha_row[x] = false;
			}
			
		    }
		    alpha_matrix[y] = alpha_row;
		}

		fulfill(alpha_matrix);
//		this.pack().pipe(fs.createWriteStream('out.png'));
	    })
    }.bind(this));
}		      

