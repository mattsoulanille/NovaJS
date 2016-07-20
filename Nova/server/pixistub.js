
PIXI = {
    Container: function() {
	this.addChild = function(){};
	this.children = [];
	this.addChildAt = function() {};
    },
    Texture: {
	fromFrame: function() {}
    },
    Sprite: function() {this.anchor = {'x':0, 'y':0};}


}
    
module.exports = PIXI;
