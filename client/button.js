function button(text, size) {
    this.container = new PIXI.Container();
    var base_url = '/objects/menus/';
    var button_urls = [['leftButton.png', 'middleButton.png', 'rightButton.png'],
		       ['leftGreyButton.png', 'middleGreyButton.png', 'rightGreyButton.png']];

    this.normal = new PIXI.Container();
    this.clicked = new PIXI.Container();

    this.container.addChild(this.normal);
    this.container.addChild(this.clicked);

    

    this.left = {
	'normal': new PIXI.Sprite.fromImage(base_url + button_urls[0][0]),
	'clicked': new PIXI.Sprite.fromImage(base_url + button_urls[1][0])
    };
    this.right = {
	'normal': new PIXI.Sprite.fromImage(base_url + button_urls[0][2]),
	'clicked': new PIXI.Sprite.fromImage(base_url + button_urls[1][2])
    };
    this.middle = {'normal':[], 'clicked':[]};
    this.middle.normal = Array(size).map(function() {
	var s = new PIXI.Sprite.fromImage(base_url + button_urls[0][1]);
	this.container.addChild(s);
	return s;
    });
    this.middle.clicked = Array(size).map(function() {
	var s = new PIXI.Sprite.fromImage(base_url + button_urls[1][1]);
	this.container.addChild(s);
	return s;
    });
    var addTo = function(toAdd) {
	Object.values(toAdd).map(function(v) {
	    this.container.addChild(v);
	}.bind(this));
    }.bind(this);

    addTo(this.left);
    addTo(this.right);

    this.placePieces();
}


button.prototype.placePieces = function() {
    Object.keys(this.middle).forEach(function(pieces) {
	

    });


}
