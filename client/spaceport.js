var menu = require("./menu.js");
var button = require("./button.js");
var outfitter = require("./outfitter.js");
var shipyard = require("./shipyard.js");

class spaceport extends menu {
    constructor(buildInfo, departCallback) { // buildInfo will contain the url or something...
	buildInfo.background = "/objects/picts/nova:8500.png";
	super(buildInfo);
	this.departCallback = departCallback;
	this.container.position.x = (global.screenW-194)/2;
	this.container.position.y = global.screenH/2;

	this.scope = "spaceport";

	this.buttons = {
	    Outfitter: new button("Outfitter", 120, {x: 160, y:116}),
	    Shipyard: new button("Shipyard", 120, {x: 160, y:74}),
	    Leave: new button("Leave", 120, {x: 160, y:200})
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
	this.buttons.Leave.on('press', this.depart.bind(this));
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
	this.onResize();
	window.addEventListener('resize', this.onResize.bind(this));
    }

    hide() {
	super.hide();
	window.removeEventListener('resize', this.onResize.bind(this));
    }


    onResize(evt) {
	var height = window.innerHeight;
	var width = window.innerWidth;
	this.container.position.x = (width-194) / 2;
	this.container.position.y = height / 2;
    }


}
module.exports = spaceport;
