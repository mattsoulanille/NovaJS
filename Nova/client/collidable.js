/*
Anything that can have collisions (with projectiles etc)
Mixin
*/

if (typeof(module) !== 'undefined') {
    var movable = require("../server/movableServer.js");
    var _ = require("underscore");
    var Promise = require("bluebird");
    var Crash = require("crash-colliders");
}


var allConvexHulls = {};



var collidable = function(superclass) {

    var collidableClass = class extends superclass {
	constructor(buildInfo, system) {
	    super(buildInfo, system);
	    if (typeof(this.buildInfo) !== 'undefined') {
		this.buildInfo.type = "collidable";
	    }
	    this.convexHullData = undefined;
	    //this.debug = true; // delete me
	}
	
	collideWith(other) {}; 
	receiveCollision(other) {};

	show() {
	    // Necessary in case show is called twice
	    if (this.crash && ! (this.crash.all().includes(this.collisionShape)) ) {
		this.collisionShape.insert();
	    }
	    super.show.call(this);
	}

	hide() {
	    if (typeof(this.collisionShape) !== 'undefined') {
		this.collisionShape.remove();
		//this.debug = false;
	    }
	    super.hide.call(this);
	}

	_removeFromSystem() {
	    if (typeof(this.collisionShape) !== 'undefined') {
		this.collisionShape.remove();
//		this.debug = false;
	    }
	    this.crash = undefined;
	    super._removeFromSystem.call(this);

	}

	_addToSystem() {
	    this.crash = this.system.crash;
	    if (this.built) {
		this.buildConvexHulls();
		if (!(this.crash.all().includes(this.collisionShape)) ) {
		    this.collisionShape.insert();
		}
	    }
	    super._addToSystem.call(this);
	}


	build() {
	    return super.build.call(this)
	    //	.then(function() {console.log(this.renderReady)}.bind(this))
		.then(this.getCollisionSprite.bind(this))
		.then(function() {
		    var url = this.getCollisionSprite();
		    return this.getConvexHulls(url);
		}.bind(this))
		.then(function(hulls) {
		    this.convexHullData = hulls;
		    if (typeof(this.system) !== 'undefined') {
			this.buildConvexHulls();
		    }

		}.bind(this));
	}
	
	buildConvexHulls() {
	    
	    this.collisionShapes = _.map(this.convexHullData, function(hullPoints) {
		/*
		// for testing
		return new this.crash.Polygon(new this.crash.V,
		[new this.crash.V(10,10),
		new this.crash.V(-10,10),
		new this.crash.V(-10,-10),
		new this.crash.V(10, -10)],
		false, this);
		*/
		
		return new this.crash.Polygon(new this.crash.Vector(0,0),
					      _.map(hullPoints, function(point) {
						  return new this.crash.Vector(point[0], point[1]);
					      }.bind(this)), false, this);
		
	    }.bind(this));
	    this.collisionShape = this.collisionShapes[0] // Default
	}
	
	getConvexHulls(url) {
	    url = url + '/convexHulls';
	    if ( !(this.allConvexHulls.hasOwnProperty(url)) ) {
		this.allConvexHulls[url] = new Promise(function(fulfill, reject) {
		    $.getJSON(url, _.bind(function(data) {
			if (data.hasOwnProperty('hulls')) {

			    fulfill(data.hulls);
			}
			else {
			    reject(new Error("data has no property hulls"))
			}
		    }, this));

		}.bind(this));
	    }

	    return this.allConvexHulls[url]

	}

	setProperties() {
	    super.setProperties.call(this);

	    if (typeof(this.properties.vulnerableTo) === 'undefined') {
		this.properties.vulnerableTo = ["normal"] // normal and/or pd
	    }
	}

	getCollisionSprite() {
	    var collisionSprite;
	    var collisionSpriteName;
	    if (_.size(this.sprites) === 1) {
		var key = _.keys(this.sprites)[0];
		collisionSprite = this.sprites[key];
		collisionSpriteName = key;
		//    console.log(collisionSpriteName);

	    }
	    else if (this.sprites.hasOwnProperty('ship')) {
		collisionSprite = this.sprites['ship'];
		collisionSpriteName = 'ship';
	    }
	    else {
		reject("no collision image");
		return;
	    }
	    this.collisionSpriteName = collisionSpriteName;
	    var url = collisionSprite.url;
	    return url;
	}

	render() {
	    super.render.call(this);
	    if (this.visible) {
		this.collisionShape.moveTo(...this.position);
	    }
	}


    }


    
    collidableClass.prototype.allConvexHulls = allConvexHulls; 



    return collidableClass;
}


if (typeof(module) !== 'undefined') {
    module.exports = collidable;
}
