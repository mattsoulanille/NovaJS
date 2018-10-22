
var _ = require("underscore");
var Promise = require("bluebird");
var spaceObject = require("../server/spaceObjectServer.js");
var planet = require("../server/planetServer.js");
var ship = require("../server/shipServer.js");
var playerShip = require("../server/playerShipServer.js");
var Crash = require("crash-colliders");
var npc = require("../server/npcServer.js");
var PIXI = require("../server/pixistub.js");
var loadsResources = require("./loadsResources.js");
var uuidv4 = require("uuid/v4");
var uuidv5 = require("uuid/v5");


class system extends loadsResources(function() {}) {
    constructor(buildInfo) {
	super(...arguments);
	this.buildInfo = buildInfo;
	if (this.buildInfo) {
	    this.id = this.buildInfo.id;
	    this.UUID = uuidv4(this.id); // There can only ever be 1 of a system
	}
	
	this.container = new PIXI.Container();
	this.spaceObjects = new Set();
	this.ships = new Set();
	this.planets = new Set();
	this.npcs = new Set();

	// Contains all projectiles that are currently vulnerable to PD
	// Not the ones that are not fired yet
	this.vulnerableToPD = new Set();
	
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
	this.targetable = new Set();
	this.built = {
	    spaceObjects: new Set(),
	    ships: new Set(),
	    planets: new Set(),

	    render: new Set(),
	    multiplayer:{}
	};

    }


    render(delta, time) {
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
    }

    async build() {
	this.meta = await this.loadResources("systems", this.id);
	await Promise.all(
	    this.meta.planets.map(function(p) {
		if (p !== null) {
		    return this.buildObject({id: p, type: "planet", UUID: uuidv5(p, this.UUID)});
		}
		return null;
	    }.bind(this))
	);
	
	// only builds things that are spaceObjects. Not outfits / weapons.
	var promises = Array.from(this.spaceObjects).map(function(obj) {
	    if (! obj.built) {
		return obj.build();
	    }
	});
	await Promise.all(promises);
    }

    addObjects(objects) {
	_.each(objects, function(b) {
	    this.addObject(b);
	}.bind(this));
    }

    addObject(obj) {
	obj.system = this;
    }

    buildObjects(buildInfo) {
	var promises = _.map(buildInfo, function(b) {
	    return this.buildObject(b);
	}.bind(this));

	return Promise.all(promises);
    }

    buildPlayerShip(buildInfo) {
	// builds and sets player ship if UUID === buildInfo.UUID
	if (buildInfo.UUID === global.UUID) {
	    //seems very hacky
	    // if (global.myShip) {
	    //     var oldPos = global.myShip.position;
	    // }
	    global.myShip = new playerShip(buildInfo, this);
	    // if (oldPos) {
	    //     global.myShip.position[0] = oldPos[0];
	    //     global.myShip.position[1] = oldPos[1];
	    // }
	    global.stagePosition = global.myShip.position;

	    if (typeof(global.stars) !== "undefined") {
		global.stars.attach(global.myShip);
	    }
	    
	    return global.myShip;
	}
	return false;

    }

    buildObject(buildInfo) {

	
	// check if the UUID is already present. If so, don't build.
	if ( (buildInfo.UUID) && (buildInfo.UUID in this.multiplayer)) {
	    console.warn("asked to build object that already exists: " + buildInfo);
	    return false; // works fine with Promise.all
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
		break;
	    default:
		throw new Error("Asked to build object of type " + type);
	    }
	}
	
	if (newObj) {
	    // in case it wasn't a ship, planet, or spaceObject...
	    return newObj.build();
	}
	
    }


    destroyObjects(uuids) {
	uuids.forEach(function(uuid) {
	    this.destroyObject(uuid);
	}.bind(this));

    }

    destroyObject(uuid) {
	if (uuid in this.multiplayer) {
	    this.multiplayer[uuid].destroy();
	}

    }


    // Replaces an object with a newly created one. For swapping ships
    async replaceObject(buildInfo) {
	if (this.multiplayer.hasOwnProperty(buildInfo.UUID)) {
	    var oldObj = this.multiplayer[buildInfo.UUID];
	    var visible = oldObj.getVisible();
	    var rendering = oldObj.getRendering();
	    var pos = [...oldObj.position];

	    buildInfo.show = (visible && rendering);
	    buildInfo.visible = visible;
	    buildInfo.position = pos;
	    
	    this.destroyObject(buildInfo.UUID);

	    await this.buildObject(buildInfo);
	    var newObj = this.multiplayer[buildInfo.UUID];

	}

    }

    removeObjects(uuids) {
	_.each(uuids, function(uuid) {
	    this.removeObject(uuid);
	}.bind(this));	
    }

    removeObject(uuid) {
	if (uuid in this.multiplayer) {

	    this.multiplayer[uuid].system = undefined;

	}
    }

    setObjects(buildInfo) {
	_.each(this.multiplayer, function(obj, uuid) {
	    if ( (typeof buildInfo !== 'undefined') && (! (uuid in buildInfo))) {
		if (obj == global.myShip) {
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
    }

    getObjects() {
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

    updateStats(stats) {
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


    getStats() {
	var stats = {};
	_.each(this.multiplayer, function(obj, uuid) {
	    stats[uuid] = obj.getStats();
	});
	return stats;
    }

    resume() {
	var time = new Date().getTime();// + timeDifference;
	this.spaceObjects.forEach(function(s) {
	    s.lastTime = time;
	}.bind(this));
    }

    destroy() {
	this.spaceObjects.forEach(function(obj) {
	    this.removeObject(obj);
	}.bind(this));
    }
}

system.prototype.getMissingObjects = _.throttle(function(missingObjects) {
    console.log("Requested missing objects: " + missingObjects);
    this.socket.emit("getMissingObjects", missingObjects);
}, 1000);


module.exports = system;
