if (typeof(module) !== 'undefined') {
    module.exports = system
    var _ = require("underscore");
    var Promise = require("bluebird");
    var spaceObject = require("../server/spaceObjectServer.js");
    var planet = require("../server/planetServer.js");
    var ship = require("../server/shipServer.js");
}


function system() {
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
	multiplayer:{}
    };

}

// system.prototype.getBuildInfo = function() {
//     return _.map(this.spaceObjects, function(value) {
// 	return value.buildInfo;
//     });
// }

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
	if (! (uuid in buildInfo)) {
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
    _.each(stats, function(newStats, uuid) {
	this.multiplayer[uuid].updateStats(newStats);
    }.bind(this));
}

system.prototype.getStats = function() {
    var stats = {};
    _.each(this.multiplayer, function(obj, uuid) {
	stats[uuid] = obj.getStats();
    });
    return stats;
}
