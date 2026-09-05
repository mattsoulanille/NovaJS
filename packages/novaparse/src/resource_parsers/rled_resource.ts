import { BaseResource } from "./nova_resource_base.js";
import { NovaResources } from "./resource_holder_base.js";
import { Resource } from "resource_fork";
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
            throw new Error("Only color depth of 16 bits / pixel supported but got " + depth);
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

            // Realign to a 4-byte boundary relative to the start of the row.
            // In practice this never fires on Nova's own data (PixelData
            // already realigns after itself and every other opcode advances
            // in multiples of 4), but keep it consistent with the row-relative
            // alignment rather than the previous opcode's count.
            if ((rowStart != 0) && ((position - rowStart) & 0x03)) {
                position += 4 - ((position - rowStart) & 0x03);
                pointer = position;
            }


            count = this.data.getUint32(pointer); pointer += 4;
            opcode = (count & 0xFF000000) >> 24;
            count &= 0x00FFFFFF;


            switch (opcode) {
                case 0://RLEOpCode_EndOfFrame = 0x00; 
                    if (currentLine != this.size[1] - 1) {
                        throw new Error("wrong number of lines in frame!:" + currentLine + "≠" + (this.size[1] - 1));
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
                    // The run's 32-bit value holds the TWO 16-bit pixels
                    // that repeat, in memory (big-endian) order: the high
                    // half first, then the low half. They are the run's
                    // own colours, not `pixel` — that is the last value
                    // an opcode-2 PixelData word left behind (or black at
                    // frame start), which is what used to be painted
                    // here, smearing the previous colour across every
                    // solid run a tool like ResForge or EVNEW emits.
                    //
                    // Half order has no ground truth to pin it against:
                    // every opcode-4 run in the stock files and in every
                    // shipped plug-in (7172 runs across 512 16-bit rlëDs,
                    // census 2026-09) has IDENTICAL halves, so both
                    // orders decode the same; ResForge's reader paints
                    // the first two bytes' colour for the whole run and
                    // its writer never emits opcode 4 at all, so a
                    // ResForge export cannot distinguish them either.
                    // Memory order is what a 32-bit store loop on the
                    // original big-endian engine produced.
                    pixelRun = this.data.getUint32(pointer); pointer += 4;
                    var runHigh = pixelRun >>> 16;
                    var runLow = pixelRun & 0xFFFF;

                    for (var i = 0; i < count; i += 4) {
                        var offset = (currentLine * this.size[0] + col) << 2;
                        mapSetColor(frames[currentFrame], offset, runHigh); col++;
                        if (i + 2 < count) {
                            var offset = (currentLine * this.size[0] + col) << 2;
                            mapSetColor(frames[currentFrame], offset, runLow); col++;
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
