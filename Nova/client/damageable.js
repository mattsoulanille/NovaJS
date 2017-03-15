/*
damageable.js
Anything that can be damaged
mixin
*/

if (typeof(module) !== 'undefined') {
    var collidable = require("../server/collidableServer.js");
    var _ = require("underscore");
    var Promise = require("bluebird");

}

damageable = (superclass) => class extends superclass {

    constructor() {
	super(...arguments);

	if (typeof(buildInfo) !== 'undefined') {
	    this.buildInfo.type = "damageable";
	}
    }

    setProperties() {
	super.setProperties.call(this);
	this.shield = this.properties.maxShields;
	this.armor = this.properties.maxArmor;
    }

    receiveCollision(other) {
	this.shield -= other.shieldDamage;
	var minShield = -this.properties.maxShields * 0.05
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

    render() {

	if (typeof(this.lastTime) != 'undefined') {
	    // Nova shield and armor regen: 1000 pts of regen equals
	    // 30 points of shield or armor per second
	    this.shield += this.properties.shieldRecharge * 30/1000 * (this.time - this.lastTime) / 1000;
	    this.armor += this.properties.armorRecharge * 30/1000 * (this.time - this.lastTime) / 1000;
	    
	    if (this.shield > this.properties.maxShields) {
		this.shield = this.properties.maxShields;
	    }
	    
	    if (this.armor > this.properties.maxArmor) {
		this.armor = this.properties.maxArmor;
	    }
	}
	
	super.render.call(this);
    }

    onDeath() {
	this.hide();
    }

}

// damageable.prototype.destroy = function() {
    
//     this.hide();
    

// }
if (typeof(module) !== 'undefined') {
    module.exports = damageable;
}
