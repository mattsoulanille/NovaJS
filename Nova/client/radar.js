function radar(meta, system, iff, density) {
    this.meta = meta;
    this.system = system;
    this.graphics = new PIXI.Graphics();
    this.iff = iff || false;
    this.density = density || false;
}

radar.prototype.scale = [2000,2000]; // scale is the dimensions of the radar in nova coords.

radar.prototype.render = function() {
//    this.graphics.clear();
    this.drawDot([0,0], 0xFFFFFF);
}

radar.prototype.drawDot = function(pos, color) {
    var size = this.meta.dataAreas.radar.size;
    var pixiPos = [(size[0] * pos[0] / this.scale[0]) + size[0] / 2,
		   -(size[1] * pos[1] / this.scale[1]) + size[1] / 2];


    if (pixiPos[0] <= size[0] && pixiPos[0] >= 0 &&
	pixiPos[1] <= size[1] && pixiPos[1] >= 0) {
//	console.log(pixiPos);

	this.graphics.lineStyle(1, color);
	this.graphics.moveTo(pixiPos[0], pixiPos[1]);
	this.graphics.lineTo(pixiPos[0]+1, pixiPos[1]);
    }
}
