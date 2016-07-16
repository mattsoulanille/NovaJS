function weapon(name, source, count) {
    this.url = 'objects/weapons/';
    this.name = name;
    this.source = source;
    this.count = count || 1;
}

weapon.prototype.build = function() {
    return this.loadResources()
	.then(this.buildWeapon.bind(this));

}

weapon.prototype.loadResources = function() {
    return new Promise( function(fulfill, reject) {
	
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

weapon.prototype.buildWeapon = function() {
    switch (this.meta.physics.type) {
    case undefined:
	this.weapon = new basicWeapon(this.name, this.source, this.meta, this.count);
	break;
    case 'unguided':
	this.weapon = new basicWeapon(this.name, this.source, this.meta, this.count);
	break;
    case 'guided':
	this.weapon = new basicWeapon(this.name, this.source, this.meta, this.count);
	break;
    case 'turret':
	this.weapon = new turretWeapon(this.name, this.source, this.meta, this.count);
	break;
    }
    return this.weapon.build()
}

weapon.prototype.fire = function() {
    return this.weapon.fire();
}

weapon.prototype.startFiring = function() {
    return this.weapon.startFiring();
}

weapon.prototype.stopFiring = function() {
    return this.weapon.stopFiring();
}

weapon.prototype.cycleTarget = function(target) {
    return this.weapon.cycleTarget(target);
}
