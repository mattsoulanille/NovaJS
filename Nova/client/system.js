if (typeof(module) !== 'undefined') {
    module.exports = system
    var _ = require("underscore");
    var Promise = require("bluebird");
    var spaceObject = require("../server/spaceObjectServer.js");
    var planet = require("../server/planetServer.js");
    var ship = require("../server/shipServer.js");
}


function system() {
    this.container = new PIXI.Container();
    this.spaceObjects = [];
    this.ships = [];
    this.planets = [];
    this.collidables = [];
    // has uuids as keys
    this.multiplayer = {};
    this.built = {
	spaceObjects:[],
	ships:[],
	planets:[],
	collidables:[],
	render:[],
	multiplayer:{}
    };

}

// system.prototype.getBuildInfo = function() {
//     return _.map(this.spaceObjects, function(value) {
// 	return value.buildInfo;
//     });
// }

system.prototype.render = function() {
    // renderes everything that is built and needs to render
    _.each(this.built.render, function(thing) {
	thing.rendered = false;
    });
    _.each(this.built.render, function(thing) {
	if ( (!thing.rendered) && (thing.rendering) ) {
	    thing.render();	    
	}
    });
};


system.prototype.build = function() {
    // only builds things that are spaceObjects. Not outfits / weapons.
    var promises = _.map(this.spaceObjects, function(obj) {
	if (! obj.built) {
	    return obj.build()
	}
	else {
	    return;
	}
    });
    return Promise.all(promises);
}

system.prototype.addObjects = function(buildInfo) {
    _.each(buildInfo, function(b) {
	this.addObject(b);
    }.bind(this));
}

system.prototype.addObject = function(buildInfo) {
    var type = buildInfo.type;
    switch (type) {
    case "spaceObject":
	new spaceObject(buildInfo, this);
	break;
    case "planet":
	new planet(buildInfo, this);
	break;
    case "ship":
	new ship(buildInfo, this);
	break;
    }
}

system.prototype.removeObjects = function(uuids) {
    _.each(uuids, function(uuid) {
	this.removeObject(uuid);
    }.bind(this));	
}

system.prototype.removeObject = function(uuid) {
    if (uuid in this.multiplayer) {

	this.multiplayer[uuid].destroy();
	delete this.multiplayer[uuid];

	if (uuid in this.built.multiplayer) {
	    delete this.built.multiplayer[uuid]
	}
    }
}

system.prototype.setObjects = function(buildInfo) {
    _.each(this.multiplayer, function(obj, uuid) {
	if ( (typeof buildInfo !== 'undefined') && (! (uuid in buildInfo))) {
	    this.removeObject(uuid);
	}

    }.bind(this));

    _.each(buildInfo, function(b, uuid) {
	if (! (uuid in this.multiplayer)) {
	    this.addObject(b);
	}
    }.bind(this));
}

system.prototype.getObjects = function() {
    var buildInfo = {};
    _.each(this.multiplayer, function(obj, uuid) {
	buildInfo[uuid] = obj.buildInfo;
    });
    return buildInfo;
}

system.prototype.updateStats = function(stats) {
    var missingObjects = [];
    _.each(stats, function(newStats, uuid) {
	if (this.multiplayer.hasOwnProperty(uuid)) {
	    this.multiplayer[uuid].updateStats(newStats);
	}
	else {
	    missingObjects.push(uuid);
	    //console.log(newStats);
	}
	
    }.bind(this));
    if (missingObjects.length != 0) {
	this.getMissingObjects(missingObjects);
    }
    
}

system.prototype.getMissingObjects = _.throttle(function(missingObjects) {
    console.log("Requested missing objects: " + missingObjects);
    this.socket.emit("getMissingObjects", missingObjects);
}, 1000);

system.prototype.getStats = function() {
    var stats = {};
    _.each(this.multiplayer, function(obj, uuid) {
	stats[uuid] = obj.getStats();
    });
    return stats;
}

system.prototype.resume = function() {
    var time = new Date().getTime() + timeDifference;
    _.each(this.spaceObjects, function(s) {
	s.lastTime = time
    }.bind(this));


}

system.prototype.destroy = function() {
    this.spaceObjects.forEach(function(obj) {
	this.removeObject(obj);
    }.bind(this));

}
