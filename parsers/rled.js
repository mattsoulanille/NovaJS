"use strict";

// see https://github.com/tjhancocks/OpenNova/blob/master/ResourceKit/ResourceFork/Parsers/RKRLEResourceParser.m
// see https://github.com/tjhancocks/OpenNova/blob/master/ResourceKit/Categories/NSData%2BParsing.h
var rled = function(resource) {
    var d = resource.data;
    var out = {};
    out.name = resource.name;
    out.id = resource.id;
    out.size = [d.getUint16(0), d.getUint16(2)];
    out.bytesPerPixel = d.getUint16(4);
    if (out.bytesPerPixel !== 16) {
	throw("Only color depth of 16 bytes / pixel supported but got " + out.bytesPerPixel);
    }
    
    out.numberOfFrames = d.getUint16(8);
    out.bytesPerRow = out.size[0] * 3;

    /*
    RLEOpCode_EndOfFrame = 0x00;
    RLEOpCode_LineStart = 0x01;
    RLEOpCode_PixelData = 0x02;
    RLEOpCode_TransparentRun = 0x03;
    RLEOpCode_PixelRun = 0x04;
    */

    var mapColor = function(color){


	return color;

    }
    
    var pointer = 16;
    var frame = 0;
    var line = 0;
    var col = 0;
    var pixel = 0;

    
    out.frames = []; //will change when matt gives better format

    var done = false;
    
    while( !done ) { //rled has an opcode which says the end
	var opcode = d.getUint8(pointer);
	var args = d.getUint32(pointer) - opcode * 0x01000000;
	pointer += 4;
	switch (opcode) {
	case 0://RLEOpCode_EndOfFrame = 0x00; 
	    if (line != out.size[1]-1) 
		throw "wrong number of lines in frame!";
	    frame++;
	    if (frame >= out.numberOfFrames){
		done = true;
	    }else{
		line = 0;
		col = 0;
		out.frames[frame] = new Array(out.size[0]);
	    }
	    break;
	case 1://RLEOpCode_LineStart = 0x01; 
	    out.frames[frame][line] = new Array(out.size[1]).fill(0);
	    line++;
	    col = 0;
	    break;
	case 2://RLEOpCode_PixelData = 0x02;
	    for(var i = 0; i < args; i+= 2){

		pixel = d.getUint16(pointer)
		pointer += 2;
		
		out.frames[frame][line][col] = mapColor(pixel);
		
		col++;
	    }
	    
	    pointer += 4-(args & 0x03);//realign

	    
	    break;
	case 3://RLEOpCode_TransparentRun = 0x03;

	    col += (args >> ((out.bytesPerPixel >> 3) - 1));
	    break;
	case 4://RLEOpCode_PixelRun = 0x04;
	    var pixelrun = d.getUint32(pointer);
	    pointer += 4;
	    for (var i = 0; i < args ; i += 4){
		out.frames[frame][line][col] = mapColor(pixel);
		col++;
		if (i+2 < args){
		    out.frames[frame][line][col] = mapColor(pixel);
		    col++;
		} // allignment

	    }
	    break;
	}
	
	
    }

    return out;
};

module.exports = rled;
