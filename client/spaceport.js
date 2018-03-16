class spaceport extends menu {
    constructor(buildInfo) {
	buildInfo.background = "/objects/menus/spaceport.png";
	super(...arguments);
	this.container.position.x = (screenW-194)/2;
	this.container.position.y = screenH/2;
	this.show();

	this.buttons = {
	    Outfitter: new button("Outfitter", 120, {x: 160, y:122}),
	    Shipyard: new button("Shipyard", 120, {x: 160, y:82})
	};

	Object.values(this.buttons).forEach(function(b) {
	    this.container.addChild(b.container);
	}.bind(this));

	
    }


    show() {
	super.show();
	window.addEventListener('resize', this.onResize.bind(this));
    }

    hide() {
	super.hide();
	window.removeEventListener('resize', this.onResize.bind(this));
    }


    onResize(evt) {
	var height = evt.currentTarget.innerHeight;
	var width = evt.currentTarget.innerWidth;
	this.container.position.x = (width-194) / 2;
	this.container.position.y = height / 2;
	if (this.visible) {
	    requestAnimationFrame(animate);// BAD BAD BAD
	}
    }


}
