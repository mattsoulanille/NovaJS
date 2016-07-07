function outfit(outfitName, count) {
    // source is a ship / object the outfit is equipped to
    this.ready = false;
    this.url = 'objects/outfits/';
    this.name = outfitName;
    this.weapons = [];
    this.count = count || 1

}


outfit.prototype.build = function(source) {
    this.source = source
    return this.loadResources()
	.then(_.bind(this.buildWeapons, this))
	.then(_.bind(this.applyEffects, this))
	.then(_.bind(function() {
	    this.ready = true;
	    
	}, this));

}

outfit.prototype.loadResources = function() {

    return new RSVP.Promise( function(fulfill, reject) {

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

outfit.prototype.buildWeapons = function() {

    this.weapons = _.map( this.meta.functions.weapon, function(weaponName) {
	return new weapon(weaponName, this.source, this.count);
    }.bind(this));

    
    if (this.meta.functions.weapon) {
	return RSVP.all(_.map( this.weapons, function(weapon) {return weapon.build()}));
    }
    else {
	return
    }

    
}

outfit.prototype.applyEffects = function() {


    if (this.meta.functions["speed increase"]) {
	this.source.properties.maxSpeed += this.meta.functions["speed increase"] * this.count
    }

}
