
var exitPoint = class {
    constructor(source, offset=[0,0,0], upCompress=[100,100], downCompress=[100,100]) {
	// Note that upCompress and downCompress for some reason do not play any role into the turn rate of the ship
	this.source = source;
	this.offset = offset;
	this.upCompress = upCompress;
	this.downCompress = downCompress;
    }

    // With respect to ship pointing angles,
    // Nova's circles are clocks, while novaJS's are unit circles
    get position() {
	var rotation = (this.source.pointing + 1.5 * Math.PI) % (2 * Math.PI);
	var rotated = this.rotate(this.offset, rotation);

	if ( (this.source.pointing > 0) && (this.source.pointing < Math.PI) ) {
	    // pointing up
	    rotated[0] *= this.upCompress[0] / 100;
	    rotated[1] *= this.upCompress[1] / 100;
	}
	else {
	    // pointing down
	    rotated[0] *= this.downCompress[0] / 100;
	    rotated[1] *= this.downCompress[1] / 100;
	}

	// z offset
	rotated[1] += this.offset[2];

	return [rotated[0] + this.source.position[0],
		rotated[1] + this.source.position[1]];
    }

    set position(pos) {
	throw new Exception("can't set exitPoint position");
    }
    
    rotate(arr, angle) {
	var copy = arr.slice();
	var x = Math.cos(angle) * copy[0] - Math.sin(angle) * copy[1];
	var y = Math.sin(angle) * copy[0] + Math.cos(angle) * copy[1];
	copy[0] = x;
	copy[1] = y;
	return copy;
    }
};

module.exports = exitPoint;

