module.exports = convexHullBuilder;
var _ = require("underscore");
var Promise = require("bluebird");
var fs = require('fs');
var PNG = require('pngjs').PNG;
var hull = require('./hull.js');
var sprite = require("./spriteServer.js");

function convexHullBuilder(source, frames) {
    // source is the source of the png data to build from
    // can be a url or a png
    this.source = source;
    this.frames = frames;
}

convexHullBuilder.prototype.buildFromSpriteSheet = function() {
    var alphaMatrix = this.makeAlphaMatrix(this.source);
    var data = this.makeConvexHulls(alphaMatrix, this.frames);
    return data;
};

convexHullBuilder.prototype.build = async function() {
    var alphaMatrix = await this.loadImage();
    var data = this.makeConvexHulls(alphaMatrix, this.collisionSprite.spriteImageInfo.frames);
    return data;
};


convexHullBuilder.prototype.makeConvexHulls = function(alphaMatrix, frames) {

    var points_array = _.map(frames, function(v) {
	//	console.log(v.frame);
	var xStart = v.frame.x;
	var yStart = v.frame.y;
	var width = v.frame.w;
	var height = v.frame.h;
	var origin = [0.5 * width + xStart,
		      0.5 * height + yStart]; // assumes sprites are anchored in center

	var points = [];
	for (var y = yStart; y < (height + yStart); y++) {
	    for (var x = xStart; x < (width + xStart); x++) {
		if (alphaMatrix[y][x] === true) {
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
	if (h.length !== 0) {
	    return h;
	}
	else {
	    return null; // since there isn't a convex hull
	}
    });

    return convex_hulls;
}

convexHullBuilder.prototype.makeAlphaMatrix = function(png) {
    var alpha_matrix = [];
    for (var y = 0; y < png.height; y++) {
	var alpha_row = [];
	for (var x = 0; x < png.width; x++) {
	    var idx = (png.width * y + x) << 2;
	    
	    // invert color
	    // png.data[idx] = 255 - png.data[idx];
	    // png.data[idx+1] = 255 - png.data[idx+1];
	    // png.data[idx+2] = 255 - png.data[idx+2];
	    
	    // and reduce opacity
	    //png.data[idx+3] = 0;
	    if (png.data[idx+3] === 255) {
		alpha_row[x] = true;
	    }
	    else {
		alpha_row[x] = false;
	    }
	    
	}
	alpha_matrix[y] = alpha_row;
    }
    
    return alpha_matrix;
};


convexHullBuilder.prototype.loadImage = function() {
    return new Promise(function(fulfill, reject) {
//	console.log(this.source);
	this.collisionSprite = new sprite(this.source);
	this.collisionSprite.build();
	var s = this.source.trim('/').split('/');
	var u = s.splice(0, s.length - 1).join("/");
	var imageURL = './'+ u + '/' + this.collisionSprite.spriteImageInfo.meta.image;

	//console.log(imageURL);
	var png = new PNG({filterType: 4});
	
	fs.createReadStream(imageURL)
	    .pipe(png)
	    .on('parsed', function() {
		var alpha_matrix = this.makeAlphaMatrix(png);
		fulfill(alpha_matrix);
	    }.bind(this));
    }.bind(this));
}		      

