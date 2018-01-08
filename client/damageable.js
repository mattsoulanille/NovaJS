/*
damageable.js
Anything that can be damaged
mixin
*/

if (typeof(module) !== 'undefined') {
    var collidable = require("../server/collidableServer.js");
    var _ = require("underscore");
    var Promise = require("bluebird");
    var errors = require("./errors.js");
    var AlliesError = errors.AlliesError;
}

damageable = (superclass) => class extends superclass {

    constructor() {
	super(...arguments);
	try {
	    this.allies = new Set([this]); // a set of things not to cause harm to.
	}
	catch(e) {
	    // projectile doesn't allow changing of allies
	    if (!(e instanceof AlliesError)) {
		throw e;
	    }
	}

	if (typeof(buildInfo) !== 'undefined') {
	    this.buildInfo.type = "damageable";
	}
    }

    setProperties() {
	super.setProperties.call(this);
	this.shield = this.properties.shield;
	this.armor = this.properties.armor;
    }

    receiveCollision(other) {
	this.shield -= other.shieldDamage;
	var minShield = -this.properties.shield * 0.05;
	if (this.shield < 0) {
	    if (this.shield < minShield) {
		this.shield = minShield;
	    }
	    this.armor -= other.armorDamage;
	}
	if (this.armor <= 0) {
	    this.armor = 0;
	    this.velocity = [0,0];
	    this.onDeath();
	}
	super.receiveCollision.call(this, other);
    }

    updateStats(stats) {
	super.updateStats.call(this, stats);
	if (typeof(stats.shield) !== 'undefined') {
	    this.shield = stats.shield;
	}
	
	if (typeof(stats.armor) !== 'undefined') {
	    this.armor = stats.armor;
	}    
    }

    getStats() {
	var stats = super.getStats.call(this);
	stats.shield = this.shield;
	stats.armor = this.armor;
	return stats;
    }

    render(delta) {

	// Nova shield and armor regen: 1000 pts of regen equals
	// 30 points of shield or armor per second
	this.shield += this.properties.shieldRecharge * 30/1000 * delta / 1000;
	this.armor += this.properties.armorRecharge * 30/1000 * delta / 1000;
	
	if (this.shield > this.properties.shield) {
	    this.shield = this.properties.shield;
	}
	
	if (this.armor > this.properties.armor) {
	    this.armor = this.properties.armor;
	}
	
	super.render(...arguments);
    }

    onDeath() {
	//this.hide();
    }

};

if (typeof(module) !== 'undefined') {
    module.exports = damageable;
}
