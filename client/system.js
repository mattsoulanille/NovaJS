if (typeof(module) !== 'undefined') {
    module.exports = system;
    var _ = require("underscore");
    var Promise = require("bluebird");
    var spaceObject = require("../server/spaceObjectServer.js");
    var planet = require("../server/planetServer.js");
    var ship = require("../server/shipServer.js");
    var Crash = require("crash-colliders");
}


function system() {
    this.container = new PIXI.Container();
    this.spaceObjects = new Set();
    this.ships = new Set();
    this.planets = new Set();
    this.npcs = new Set();
    this.crash = new Crash({maxEntries:10});
    this.crash.onCollision(function(a, b, res, cancel) {
	//console.log(a.data + " collided with " + b.data);
	// the entire space object is stored in collider.data... is this bad?
	// for garbage collection, yes...?
	a.data.collideWith(b.data, res);
	b.data.collideWith(a.data, res);
    });

    // this.ships.add = function(t) {
    // 	console.log("added");

    // }.bind(this);
    
    // has uuids as keys
    this.multiplayer = {};
    this.built = {
	spaceObjects: new Set(),
	ships: new Set(),
	planets: new Set(),

	render: new Set(),
	multiplayer:{}
    };


}

// system.prototype.getBuildInfo = function() {
//     return _.map(this.spaceObjects, function(value) {
// 	return value.buildInfo;
//     });
// }

system.prototype.render = function(delta, time) {
    // renderes everything that is built and needs to render
    this.built.render.forEach(function(thing) {
	thing.rendered = false;
    });
    this.built.render.forEach(function(thing) {
	if ( !thing.rendered ) {
	    thing.render(delta, time);
	}
    });
    this.crash.check();
    this.renderContainer();
}

system.prototype.renderContainer = function() {
    // stagePosition is the player ship's position.
    // this will probably need to be revised to be more clear.
    this.container.position.x = - stagePosition[0] + (screenW - 194) / 2;
    this.container.position.y = stagePosition[1] + screenH / 2;
}

system.prototype.build = function() {
    // only builds things that are spaceObjects. Not outfits / weapons.
    var promises = Array.from(this.spaceObjects).map(function(obj) {
	if (! obj.built) {
	    return obj.build();
	}
    });
    return Promise.all(promises);
}

system.prototype.addObjects = function(objects) {
    _.each(objects, function(b) {
	this.addObject(b);
    }.bind(this));
}

system.prototype.addObject = function(obj) {
    obj.system = this;
}

system.prototype.buildObjects = function(buildInfo) {
    
    var promises = _.map(buildInfo, function(b) {
	return this.buildObject(b);
    }.bind(this));

    return Promise.all(promises);
}

system.prototype.buildPlayerShip = function(buildInfo) {
    // builds and sets player ship if UUID === buildInfo.UUID
    if (buildInfo.UUID === UUID) {
	//seems very hacky
	myShip = new playerShip(buildInfo, this);

	if (typeof(stars) !== "undefined") {
	    stars.attach(myShip);
	}
	
	return myShip;
    }
    return false;

}

system.prototype.buildObject = function(buildInfo) {

    
    // check if the UUID is already present. If so, don't build.
    if ( (buildInfo.UUID) && (buildInfo.UUID in this.multiplayer)) {
	return false; // works fine with Promise.all
	// maybe throw an exception? but don't want to break server, but do want to know if this happens.
    }
    
    // checks if is player ship
    // confusing, but it only builds it if it is the playerShip
    var newObj = this.buildPlayerShip(buildInfo);
    if (newObj === false) {
	var type = buildInfo.type;
	switch (type) {
	case "spaceObject":
	    newObj = new spaceObject(buildInfo, this);
	    break;
	case "planet":
	    newObj = new planet(buildInfo, this);
	    break;
	case "ship":
	    newObj = new ship(buildInfo, this);
	    break;
	case "npc":
	    newObj = new npc(buildInfo, this);
	}
    }
    
    if (newObj) {
	// in case it wasn't a ship, planet, or spaceObject...
	return newObj.build();
    }
    
}


system.prototype.destroyObjects = function(uuids) {
    uuids.forEach(function(uuid) {
	this.destroyObject(uuid);
    }.bind(this));

}

system.prototype.destroyObject = function(uuid) {
    if (uuid in this.multiplayer) {
	this.multiplayer[uuid].destroy();
    }

}

system.prototype.removeObjects = function(uuids) {
    _.each(uuids, function(uuid) {
	this.removeObject(uuid);
    }.bind(this));	
}

system.prototype.removeObject = function(uuid) {
    if (uuid in this.multiplayer) {

	this.multiplayer[uuid].system = undefined;

    }
}

system.prototype.setObjects = function(buildInfo) {
    _.each(this.multiplayer, function(obj, uuid) {
	if ( (typeof buildInfo !== 'undefined') && (! (uuid in buildInfo))) {
            if (obj == myShip) {
                console.log("Server claims player's ship does not exist");
		this.removeObject(uuid);
		obj.destroy();
            }
	    else {
		this.removeObject(uuid);
	    }
	}

    }.bind(this));

    var promises = [];
    
    _.each(buildInfo, function(b, uuid) {
	if (uuid in this.multiplayer) {
	    this.multiplayer[uuid].destroy();
	}
	promises.push(this.buildObject(b));

	
    }.bind(this));

    return Promise.all(promises);
};

system.prototype.getObjects = function() {
    var buildInfo = {};
    _.each(this.built.multiplayer, function(obj, uuid) {
	// only send specific object types
	if (['ship','playership','planet', 'npc'].includes(obj.buildInfo.type)) {
	    // protect objects from having their buildinfo changed
	    buildInfo[uuid] = Object.assign({}, obj.buildInfo);
	}
	
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
    this.spaceObjects.forEach(function(s) {
	s.lastTime = time;
    }.bind(this));


}

system.prototype.destroy = function() {
    this.spaceObjects.forEach(function(obj) {
	this.removeObject(obj);
    }.bind(this));

}
