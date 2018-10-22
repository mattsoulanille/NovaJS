var menu = require("./menu.js");
var button = require("./button.js");
var outfitter = require("./outfitter.js");
var shipyard = require("./shipyard.js");
var PIXI = require("../server/pixistub.js");

class spaceport extends menu {
    constructor(buildInfo, departCallback) {
	buildInfo.background = "nova:8500";
	super(buildInfo);
	this.departCallback = departCallback;
	this.container.position.x = (global.screenW-194)/2;
	this.container.position.y = global.screenH/2;

	this.scope = "spaceport";
	this.text = {};

	this.buttons = {
	    Outfitter: new button("Outfitter", 120, {x: 160, y:116}),
	    Shipyard: new button("Shipyard", 120, {x: 160, y:74}),
	    Leave: new button("Leave", 120, {x: 160, y:200})
	};

	Object.values(this.buttons).forEach(function(b) {
	    this.container.addChild(b.container);
	}.bind(this));

	// make the spaceport pict
	this.spaceportPict = this.data.sprite.fromPict(this.buildInfo.landingPictID);
	this.spaceportPict.position.x = -306;
	this.spaceportPict.position.y = -256;
	this.container.addChild(this.spaceportPict);


	// Make the planet title
	this.font = {
	    title: {fontFamily:"Geneva", fontSize:18, fill:0xffffff,
		    align:'center'},
	    desc:  {fontFamily:"Geneva", fontSize:9, fill:0xffffff,
		      align:'left', wordWrap:true, wordWrapWidth:301}

	};
	this.text.title = new PIXI.Text(this.buildInfo.name, this.font.title);
	this.text.title.position.x = -24;
	this.text.title.position.y = 39;
	this.container.addChild(this.text.title);

	this.text.desc = new PIXI.Text(this.buildInfo.landingDesc, this.font.desc);
	this.text.desc.position.x = -149;
	this.text.desc.position.y = 70;
	this.container.addChild(this.text.desc);
				       
	
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
