module.exports = convexHullBuilder;
var _ = require("underscore");
var Promise = require("bluebird");
var fs = require('fs');
var PNG = require('pngjs').PNG;
var hull = require('./hull.js');
var sprite = require("./spriteServer.js");

function convexHullBuilder(url) {
    this.url = url;
}

convexHullBuilder.prototype.build = function() {
//    console.log("Building convex hull " + this.url);
    return new Promise(function(fulfill, reject) {
	this.loadImage()
	    .then(this.makeConvexHulls.bind(this))
	    .then(function(data) {
		fulfill(data);
	    }.bind(this))
//	fulfill("test hulls " + this.url + this.name);

    }.bind(this));

}


convexHullBuilder.prototype.makeConvexHulls = function(pixelArray) {

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
	// the last element is the same as the first,
	// and crash does not like that...
	var h = hull(points);
	h.pop();
	return h;
    });

    return convex_hulls;
}


convexHullBuilder.prototype.loadImage = function() {
    return new Promise(function(fulfill, reject) {
//	console.log(this.url);
	this.collisionSprite = new sprite(this.url);
	this.collisionSprite.build();
	var s = this.url.trim('/').split('/');
	var u = s.splice(0, s.length - 1).join("/");
	var imageURL = './'+ u + '/' + this.collisionSprite.spriteImageInfo.meta.image;

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

