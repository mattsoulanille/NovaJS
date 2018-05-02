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
    this.system.planets.forEach(this.drawPlanet.bind(this));
    this.drawDot(this.source.position, 0xFFFFFF);
    /*
    for (var i = 1; i < this.system.ships.length; i++) {
	this.drawShip(this.system.ships[i]);
    }
*/
}


radar.prototype.drawShip = function(s) {
    if (!s.getVisible()) {
	return;
    }
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
    this.drawDot(p.position, color, 2);
}

radar.prototype.drawDot = function(pos, color, size=1) {
    // draws a dot from nova position
    var radarSize = this.meta.dataAreas.radar.size;
    var pixiPos = [(radarSize[0] * (pos[0] - this.source.position[0]) / this.scale[0]) + radarSize[0] / 2,
		   -(radarSize[1] * (pos[1] - this.source.position[1]) / this.scale[1]) + radarSize[1] / 2];
    

    if (pixiPos[0] <= radarSize[0] && pixiPos[0] >= 0 &&
	pixiPos[1] <= radarSize[1] && pixiPos[1] >= 0) {
	// make this work with any sizes
	this.graphics.lineStyle(1, color);
	if (size == 1) {
	    //	console.log(pixiPos);
	    this.graphics.moveTo(pixiPos[0], pixiPos[1]);
	    this.graphics.lineTo(pixiPos[0]+1, pixiPos[1]); // kinda hacky
	}
	else if (size == 2) {
	    this.graphics.moveTo(pixiPos[0], pixiPos[1]);
	    this.graphics.lineTo(pixiPos[0]+2, pixiPos[1]); // kinda hacky
	    this.graphics.moveTo(pixiPos[0], pixiPos[1]+1);
	    this.graphics.lineTo(pixiPos[0]+2, pixiPos[1]+1); // kinda hacky

	}
    }
}
