// A single menu window
function menu(buildInfo) {
    this.buildInfo = buildInfo;
    this.container = new PIXI.Container();
    this.container.visible = false;
    landed.addChild(this.container);
    
    if (typeof this.buildInfo !== 'undefined') {
	this.background = new PIXI.Sprite.fromImage(this.buildInfo.background);
	this.container.addChild(this.background);
	this.text = new PIXI.Text("Placeholder");
    }

    this.buttons = [];
}



menu.prototype.show = function() {
    this.container.visible = true;
}

menu.prototype.hide = function() {
    this.container.visible = true;
}

