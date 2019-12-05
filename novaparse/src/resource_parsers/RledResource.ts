import { BaseResource } from "./NovaResourceBase";
import { NovaResources } from "./ResourceHolderBase";
import { Resource } from "resourceforkjs";
import { PNG } from "pngjs";

class RledResource extends BaseResource {
    size: number[];
    constructor(resource: Resource, idSpace: NovaResources) {
        super(resource, idSpace);
        this.size = [this.data.getUint16(0), this.data.getUint16(2)];
    }


    get bitsPerPixel(): number {
        var depth = this.data.getUint16(4);
        if (depth !== 16) {
            throw new Error("Only color depth of 16 bits / pixel supported but got " + this.bitsPerPixel);
        }
        return depth;
    }

    get numberOfFrames(): number {
        return this.data.getUint16(8);
    }

    get bytesPerRow(): number {
        return this.size[0] * 3;
    }

    get frames(): Array<PNG> {
        var PNGSettings = { filterType: 4, width: this.size[0], height: this.size[1] };
        var frames: Array<PNG> = [new PNG(PNGSettings)];

        var pointer = 16;//_data.position
        var position = 0;
        var rowStart = 0;
        var currentLine = -1;
        //var currentOffset = 0; for the storage, unneeded here
        var col = 0;

        var opcode = 0;
        var count = 0;
        var pixel = 0;
        var currentFrame = 0;
        var pixelRun = 0;

        var lineLength = this.size[0];
        var keep_going = true;

        while (keep_going) { //rled has an opcode which says the end
            position = pointer;

            if ((rowStart != 0) && ((position - rowStart) & 0x03)) {
                position += 4 - ((position - rowStart) & 0x03);
                pointer += 4 - (count & 0x03);
            }


            count = this.data.getUint32(pointer); pointer += 4;
            opcode = (count & 0xFF000000) >> 24;
            count &= 0x00FFFFFF;


            switch (opcode) {
                case 0://RLEOpCode_EndOfFrame = 0x00; 
                    if (currentLine != this.size[1] - 1) {
                        throw "wrong number of lines in frame!:" + currentLine + "≠" + (this.size[1] - 1);
                    }
                    if (++currentFrame >= this.numberOfFrames) {
                        keep_going = false;
                        break;
                    }

                    currentLine = -1;



                    frames[currentFrame] = new PNG({
                        filterType: 4,
                        width: this.size[0],
                        height: this.size[1]
                    });

                    break;
                case 1://RLEOpCode_LineStart = 0x01; 

                    ++currentLine;
                    col = 0;

                    rowStart = pointer;

                    //		frames[currentFrame][currentLine] = new Array(lineLength).fill(0); //default is clear

                    break;
                case 2://RLEOpCode_PixelData = 0x02;
                    for (var i = 0; i < count; i += 2) {

                        pixel = this.data.getUint16(pointer); pointer += 2;

                        var offset = (currentLine * this.size[0] + col) << 2;
                        mapSetColor(frames[currentFrame], offset, pixel); col++;


                    }

                    if (count & 0x03)
                        pointer += 4 - (count & 0x03);//realign


                    break;
                case 3://RLEOpCode_TransparentRun = 0x03;

                    col += (count >> ((this.bitsPerPixel >> 3) - 1));
                    break;
                case 4://RLEOpCode_PixelRun = 0x04;
                    pixelRun = this.data.getUint32(pointer); pointer += 4;

                    for (var i = 0; i < count; i += 4) {
                        var offset = (currentLine * this.size[0] + col) << 2;
                        mapSetColor(frames[currentFrame], offset, pixel); col++;
                        if (i + 2 < count) {
                            var offset = (currentLine * this.size[0] + col) << 2;
                            mapSetColor(frames[currentFrame], offset, pixel); col++;
                        } // allignment

                    }
                    break;
            }
        }

        return frames;
    }





}

function mapSetColor(place: PNG, offset: number, color: number) {

    var blue = color & 0x001F;//5 bits
    var green = (color & 0x03E0) >> 5;//5 bits
    var red = (color & 0x7C00) >> 10;//5 bits
    var alpha = 0xFF;// * ((color & 0x8000) >> 15);

    //scale
    blue = blue << 3;
    green = green << 3;
    red = red << 3;

    //refit
    blue |= blue >> 5;
    green |= green >> 5;
    red |= red >> 5;

    //avoid sign bit annoyance cause matt wants it positive, less efficient but doesn't matter after conversion to image
    //	var rgb = (red << 16) | (green << 8) | blue;

    //	console.log(green);
    //	console.log(red);
    place.data[offset + 0] = 0xFF & red;
    place.data[offset + 1] = 0xFF & green;
    place.data[offset + 2] = 0xFF & blue;
    place.data[offset + 3] = 0xFF & alpha;

    //	return rgb + (alpha * 0x01000000);

}

export { RledResource }
