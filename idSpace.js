"use strict";



var idSpace = class {
    constructor() {
	this.spaces = {};
	// all the resources in existance
	// stored by type first. then by id (ex: resources['weap']['nova:128'])
	this._resources = {};

	// kind of like defaultDict from python
	this.resources = new Proxy(this._resources, {
	    // this should probably be replaced with just adding each nova type to the object manually.
	    get: function(target, property, receiver) {
		if (!(property in target) ) {
		    //use in to also check the prototype chain
		    target[property] = {};
		}
		return target[property];
	    }
	});
    }

    addNovaData(resources) {
	return this.addPlugin(resources, "nova");
    }
    
    addPlugin(resources, prefix) {

	var pluginSpace = this.getSpace(prefix);
	Object.keys(resources).forEach(function(type) {
	    Object.keys(resources[type]).forEach(function(id) {
		// remember that novaSpace is a proxy.

		resources[type][id].prefix = prefix;
		resources[type][id].idSpace = this.getSpace(prefix);
		resources[type][id].globalID = prefix + ":" + id;

		pluginSpace[type][id] = resources[type][id];
	    }.bind(this));
	}.bind(this));
    }
    
    getSpace(prefix) {
	// opens an id space with the given prefix
	if (! this.spaces.hasOwnProperty(prefix)) {
	    var p = new Proxy({}, {
		get: function(target, property, receiver) {
		    if (typeof property === "symbol") {
			return false;
		    }
		    if (!(property in target)) {
			target[property] = new Proxy(this.resources[property], {
			    get: function(target, id, receiver) {
				if (typeof id === "symbol") {
				    return false;
				}
				
				if ( ("nova:" + String(id)) in target ) {
				    return target["nova:" + String(id)];
				}

				return target[prefix + ":" + String(id)];
			    },
			    set: function(target, id, value, receiver) {
				if (typeof id === "symbol") {
				    return true;
				}

				if ( ("nova:" + String(id)) in target ) {
				    target["nova:" + String(id)] = value;
				    return true;
				}

				target[prefix + ":" + String(id)] = value;
				return true;
			    }
			});
		    }
		    return target[property];

		}.bind(this),
		set: function() {
		    throw "tried to set entire type of resoures";
		}
	    });

	    this.spaces[prefix] = p;

	}

	return this.spaces[prefix];

    }



};

module.exports = idSpace;
