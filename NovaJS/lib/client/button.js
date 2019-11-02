var eventable = require("../libraries/eventable.js");
var visible = require("./visible.js");
var loadsResources = require("./loadsResources.js");

class button extends loadsResources(eventable(visible(function() {}))) {
    constructor (text, size, position = {x:0, y:0}) {
	super();

	this.container.position.x = position.x;
	this.container.position.y = position.y;
	this.size = size;
	this.height = 25; // Height: An experimentally determined magic number.
	var button_ids =
	    {'normal': ['nova:7500', 'nova:7501', 'nova:7502'],
	     'clicked': ['nova:7503', 'nova:7504', 'nova:7505'],
	     'grey': ['nova:7506', 'nova:7507', 'nova:7508']
	    };
	
	// this.sprites = {
	//     left: new PIXI.Sprite,
	//     middle: new PIXI.Sprite,
	//     right: new PIXI.Sprite
	// };

	this.containers = {};
	this.left = {};
	this.right = {};
	this.middle = {};

	
	// This should use texture switching instead of sprite switching,
	// but that's tough since PIXI.extras.TilingSprite is used
	Object.keys(button_ids).forEach(function(buttonType) {
	    
	    this.left[buttonType] = this.data.sprite.fromPict(button_ids[buttonType][0]);
	    this.left[buttonType].anchor.x = 1;
	    this.right[buttonType] = this.data.sprite.fromPict(button_ids[buttonType][2]);

	    this.left[buttonType].interactive = true;
	    this.left[buttonType].buttonMode = true;
	    
	    this.middle[buttonType] =
		new PIXI.extras.TilingSprite(
		    this.data.texture.fromPict(button_ids[buttonType][1]),
		    size,
		    this.height
		);

	    var c = this.containers[buttonType] = new PIXI.Container();
	    c.addChild(this.left[buttonType]);
	    c.addChild(this.right[buttonType]);
	    c.addChild(this.middle[buttonType]);
	    this.container.addChild(c);
	    c.visible = false;

	}.bind(this));


	// See colr resource
	this.font = {
	    normal:  {fontFamily:"Geneva", fontSize:12, fill:0xffffff, align:'center'},
	    clicked: {fontFamily:"Geneva", fontSize:12, fill:0x808080, align:'center'},
	    grey:    {fontFamily:"Geneva", fontSize:12, fill:0x262626, align:'center'}
	};

	this.text = new PIXI.Text(text, this.font.normal);
	this.text.anchor.x = 0.5;
	this.text.anchor.y = 0.5;

	this.container.addChild(this.text);

	this.containers['normal'].visible = true;

	this.placePieces();
	// var t = new PIXI.Sprite(this.containers["normal"].generateTexture(renderer));
	// this.container.addChild(t);
	


	this.show();


	this.container.interactive = true;
	this.container.buttonMode = true;
	this.container.on('pointerdown', this._onPointerDown.bind(this))
            .on('pointerup', this._onPointerUp.bind(this))
            .on('pointerupoutside', this._onPointerUpOutside.bind(this));
            // .on('pointerover', onButtonOver)
            // .on('pointerout', onButtonOut);
	

	// test graphics

	// var g = new PIXI.Graphics();
	// g.lineStyle(1, 0xffd900, 1);
	// g.moveTo(0,0);
	// g.lineTo(0,100);
	// this.container.addChild(g);
    } 

    _onPointerDown() {
	this.setClicked(1);	
    }

    _onPointerUp() {
	this._onPointerUpOutside();
	this.emit('press');
    }

    _onPointerUpOutside() {
	this.setClicked(0);
    }

    setClicked(val) {
	if (val == 1) {
	    this.text.style = this.font.clicked;
	    this.containers.normal.visible = false;
	    this.containers.clicked.visible = true;
	    this.containers.grey.visible = false;
	}
	else if (val == 0) {
	    this.text.style = this.font.normal;
	    this.containers.normal.visible = true;
	    this.containers.clicked.visible = false;
	    this.containers.grey.visible = false;
	}
	else {
	    this.text.style = this.font.grey;
	    this.containers.normal.visible = false;
	    this.containers.clicked.visible = false;
	    this.containers.grey.visible = true;
	}
    }
    
    placePieces() {

	var pos = 13.2; // length of the left side.
	Object.values(this.left).forEach(function(v) {
	    v.position.x = pos;
	});
	

	this.text.position.x = pos + this.size / 2;
	this.text.position.y = this.height/2;
	Object.values(this.middle).forEach(function(v) {
	    v.position.x = pos;
	});

	pos += this.size;
	Object.values(this.right).forEach(function(v) {
	    v.position.x = pos;
	});

    }
}
module.exports = button;
