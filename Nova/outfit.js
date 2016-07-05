function outfit(outfitName) {
    this.url = 'objects/outfits/'
    this.name = outfitName
}


outfit.prototype.build = function() {

    $.getJSON(this.url + this.name + ".json", _.bind(function(data) {
	this.meta = data;

    }, this));


}
