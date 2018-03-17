class spaceport extends menu {
    constructor(buildInfo, departCallback) { // buildInfo will contain the url or something...
	buildInfo.background = "/objects/menus/spaceport.png";
	super(buildInfo);
	this.departCallback = departCallback;
	this.container.position.x = (screenW-194)/2;
	this.container.position.y = screenH/2;

	this.scope = "spaceport";

	this.buttons = {
	    Outfitter: new button("Outfitter", 120, {x: 160, y:122}),
	    Shipyard: new button("Shipyard", 120, {x: 160, y:82})
	};

	Object.values(this.buttons).forEach(function(b) {
	    this.container.addChild(b.container);
	}.bind(this));



	// make the other menus
	this.outfitter = new outfitter();
	this.container.addChild(this.outfitter.container);

	this.shipyard = new shipyard();
	this.container.addChild(this.shipyard.container);
	
	this.boundControls = [];
	
	// Assign the buttons so they move through menus
	this.buttons.Outfitter.on('press', this.showOutfitter.bind(this));
	this.buttons.Shipyard.on('press', this.showShipyard.bind(this));
    }

    bindControls() {
	super.bindControls();
	this.boundControls = [
	    this.controls.onStart(this.scope, "depart", this.depart.bind(this)),
	    this.controls.onStart(this.scope, "outfitter", this.showOutfitter.bind(this)),
	    this.controls.onStart(this.scope, "shipyard", this.showShipyard.bind(this))
	];
    }

    depart() {
	this.hide();
	this.departCallback();
    }
    
    showOutfitter() {
	this.outfitter.show();
    }

    showShipyard() {
	this.shipyard.show();
    }
    
    show() {
	super.show();
//	window.addEventListener('resize', this.onResize.bind(this));
    }

    hide() {
	super.hide();
//	window.removeEventListener('resize', this.onResize.bind(this));
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
