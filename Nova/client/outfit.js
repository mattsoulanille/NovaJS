if (typeof(module) !== 'undefined') {
    var _ = require("underscore");
    var Promise = require("bluebird");
    var weapon = require("../server/weaponServer.js");
    var inSystem = require("./inSystem.js");
}


outfit = class extends inSystem {
    constructor(buildInfo) {
	// source is a ship / object the outfit is equipped to
	super(...arguments);
	this.buildInfo = buildInfo;
	this.ready = false;
	this.url = 'objects/outfits/';
	if (typeof(buildInfo) !== 'undefined') {
	    this.name = buildInfo.name;
	    this.count = buildInfo.count || 1;
	}
	this.weapons = [];
    }
    

    build(source) {
	this.source = source
	return this.loadResources()
	    .then(_.bind(this.buildWeapons, this))
	    .then(_.bind(this.applyEffects, this))
	    .then(_.bind(function() {
		this.ready = true;
		
	    }, this));
	
    }

    loadResources() {

	return new Promise( function(fulfill, reject) {
	    // fix me to not use jquery
	    $.getJSON(this.url + this.name + ".json", _.bind(function(data) {
		this.meta = data;
		
		if ((typeof(this.meta) !== 'undefined') && (this.meta !== null)) {
		    fulfill();
		}
		else {
		    reject();
		}
		
		
	    }, this));
	    
	}.bind(this));
	
	
    }

    buildWeapons() {

	this.weapons = _.map( this.meta.functions.weapon, function(weaponName) {
	    var buildInfo = {
		"name": weaponName,
		"source": this.source.UUID,
		"count": this.count,
	    };
	    if (typeof this.buildInfo.UUIDS !== 'undefined') {
		buildInfo.UUID = this.buildInfo.UUIDS[buildInfo.name];
	    }
	    if (typeof this.buildInfo.socket !== 'undefined') {
		buildInfo.socket = this.buildInfo.socket;
	    }
	    var w = new weapon(buildInfo, this.source);
	    this.addChild(w);
	    return w;
	}.bind(this));
	
	
	if (this.meta.functions.weapon) {
	    return Promise.all(_.map( this.weapons, function(weapon) {return weapon.build()}));
	}
	else {
	    return
	}
	
	
    }

    applyEffects() {
	
	
	if (this.meta.functions["speed increase"]) {
	    this.source.properties.maxSpeed += this.meta.functions["speed increase"] * this.count
	}
	
    }

    destroy() {
	_.each(this.weapons, function(w) {w.destroy()});
	
    }
}

if (typeof(module) !== 'undefined') {
    module.exports = outfit;
}
