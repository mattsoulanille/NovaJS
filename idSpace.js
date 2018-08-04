"use strict";



var idSpace = class {
    constructor() {
	this.spaces = {};
	// all the resources in existance
	// stored by type first. then by id (ex: resources['weap']['nova:128'])
	this._resources = {};

	// kind of like defaultDict from python
	// but also it only stores objects that store functions. 
	// When accessing a property of one of its stored objects,
	// it returns the value of calling the function.
	this.resources = new Proxy(this._resources, {
	    // this should probably be replaced with just adding each nova type to the object manually.
	    get: function(target, property, receiver) {
		if (!(property in target) ) {
		    //use "in" to also check the prototype chain
		    target[property] = new Proxy({}, {
			get: function(target, id, receiver) {
			    if (typeof id === "symbol") {
				return false;
			    }
			    // target[id] is known to be a function
			    // because of how "set" is written.
			    var resFunction = target[id];
			    if (resFunction) {
				return resFunction();
			    }
			    else {
				return undefined;
			    }
			},
			set: function(target, id, value, receiver) {
			    if (typeof id === "symbol") {
				return true;
			    }
			    if (typeof value !== "function") {
				throw new Error("Only functions can be assigned");
			    }
			    target[id] = value;
			    return true;
			}
		    });
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
		var resourceGetFunction = resources[type][id];

		var globalID;
		var idSpace = pluginSpace;
		// if there's already a resource at this one's id (in its prefix),
		// then this one's global id is the id of the resource it will replace.
		var currentVal = pluginSpace[type][id];
		if ((typeof currentVal !== "undefined") &&
		    (typeof currentVal.globalID !== "undefined")) {
		    globalID = currentVal.globalID;
		}
		else {
		    globalID = prefix + ":" + id;
		}
		pluginSpace[type][id] = function() {
		    var resource = resourceGetFunction();
		    resource.globalID = globalID;
		    resource.idSpace = idSpace;
		    resource.globalSpace = this.resources;
		    resource.prefix = prefix;
		    resource.id = id;
		    return resource;
		}.bind(this);
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
				else {
				    return target[prefix + ":" + String(id)];
				}
			    },
			    set: function(target, id, value, receiver) {
				if (typeof id === "symbol") {
				    return true;
				}
				
				if ( ("nova:" + String(id)) in target ) {
				    target["nova:" + String(id)] = value;
				}
				else {
				    target[prefix + ":" + String(id)] = value;
				}
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
