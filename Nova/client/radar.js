function radar(meta, source, iff, density) {
    this.meta = meta;
    this.source = source;
    if (typeof source !== 'undefined') {
	this.system = source.system;
    }
    this.graphics = new PIXI.Graphics();
    this.iff = iff || false;
    this.density = density || false;
}

radar.prototype.scale = [6000,6000]; // scale is the dimensions mapped to the radar in nova coords.

radar.prototype.render = function() {
    this.graphics.clear();
    
    this.system.ships.forEach(this.drawShip.bind(this));
    this.drawDot(this.source.position, 0xFFFFFF);
    /*
    for (var i = 1; i < this.system.ships.length; i++) {
	this.drawShip(this.system.ships[i]);
    }
*/
}


radar.prototype.drawShip = function(s) {
    var color;
    var size;
    if (this.iff) {
	color = 0x0000FF; // implement whether they hate you later
	// color = 0xFF0000 // angry

    }
    else {
	color = this.meta.colors.dimRadar;
    }
    this.drawDot(s.position, color);
}
radar.prototype.drawPlanet = function(p) {
    var color = 0xFFFF00; // neutral
    
}

radar.prototype.drawDot = function(pos, color, size) {
    // draws a dot from nova position
    var size = this.meta.dataAreas.radar.size;
    var pixiPos = [(size[0] * (pos[0] - this.source.position[0]) / this.scale[0]) + size[0] / 2,
		   -(size[1] * (pos[1] - this.source.position[1]) / this.scale[1]) + size[1] / 2];
    

    if (pixiPos[0] <= size[0] && pixiPos[0] >= 0 &&
	pixiPos[1] <= size[1] && pixiPos[1] >= 0) {
//	console.log(pixiPos);

	this.graphics.lineStyle(1, color);
	this.graphics.moveTo(pixiPos[0], pixiPos[1]);
	this.graphics.lineTo(pixiPos[0]+1, pixiPos[1]); // kinda hacky
    }
}
