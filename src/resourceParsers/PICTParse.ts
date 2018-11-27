//
// MIT License
//
// Copyright (c) 2016 Tom Hancocks, 2018 Matthew Soulanille
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//

// (1) Adapted from https://github.com/dmaulikr/OpenNova/blob/master/ResourceKit/ResourceFork/Parsers/RKPictureResourceParser.m

// (2) Also see http://mirrors.apple2.org.za/apple.cabi.net/Graphics/PICT.and_QT.INFO/PICT.file.format.TI.txt


import { PNG } from "pngjs";

const wordSize = 2; // 2 bytes

// Opcodes                      // Data Size and format (bytes)
const noop = 0x0000;            // 0
const clipRegion = 0x0001;      // region size (??)
const directBitsRect = 0x009A;  // 2 bytes data length + data
const eof = 0x00FF;             // 2?
const defaultHilite = 0x001E;   // 0?
const longComment = 0x00A1;     // kind, size = 4 + data
const extendedHeader = 0x0C00;  // 24

// Mac Rectangles are structs of this form:
//  int16_t y1
//  int16_t x1
//  int16_t y2
//  int16_t x2


class PICTParse {
    PNG: PNG;
    yRatio: number;
    xRatio: number;
    pos: number;
    d: DataView;
    constructor(dataView: DataView) {
        this.d = dataView;
        this.pos = 0;

        // first two bytes are unused
        this.pos += 2;

        // Frame of pict
        var frame = this.readQDRect();

        // Version of the PICT. Only version 2 is supported.
        var vers = this.reaDWord();

        if (vers !== 0x1102ff) {
            throw new Error("Wrong PICT version. Must be version 2");
        }

        // Expect an extended header
        var opcode = this.readOpcode();

        if (opcode !== extendedHeader) {
            throw new Error("PICT did not have extended header.");
        }

        // Nova uses two header versions
        var headerVersion = this.reaDWord();

        // Note that js bitwise operators first convert the number into int32_t
        if ((headerVersion >>> 16) !== 0xFFFE) {
            // Standard Header Version

            // Determine image resolution
            this.log(this.pos);
            var y2 = this.readFixedPoint();
            var x2 = this.readFixedPoint();
            var w2 = this.readFixedPoint();
            var h2 = this.readFixedPoint();

            this.log(frame);
            this.log([y2, x2, w2, h2]);

            this.xRatio = (frame.x2 - frame.x1) / (w2 - x2);
            this.yRatio = (frame.y2 - frame.y1) / (h2 - y2);
        }
        else {
            this.pos += 4 * 2; // 2 * uint32
            var rect = this.readQDRect();
            this.xRatio = (frame.x2 - frame.x1) / (rect.x2 - rect.x1);
            this.yRatio = (frame.y2 - frame.y1) / (rect.y2 - rect.y1);
        }

        // Verify ratio is valid
        if (this.xRatio <= 0 || this.yRatio <= 0) {
            throw new Error("Got invalid ratio: " + this.xRatio + ", " + this.yRatio);
        }

        this.PNG = this.runOpcodes();
    }

    runOpcodes() {
        while (this.pos < this.d.byteLength) {
            var op = this.readOpcode();

            if (op == eof) {
                break;
            }
            switch (op) {
                case clipRegion:
                    this.log("Got Opcode clipRegion");
                    this.readRegionWithRect();
                    break;
                case directBitsRect:
                    this.log("Got Opcode directBitsRect");
                    return this.parseDirectBitsRect();
                case longComment:
                    this.log("Got Opcode longComment");
                    this.parseLongComment();
                    break;
                case noop:
                    this.log("Got Opcode noop");
                    break;
                case extendedHeader:
                    this.log("Got Opcode extendedHandler");
                    break;
                case defaultHilite:
                    this.log("Got Opcode defaultHilite");
                    break;
                default:
                    throw new Error("Unsupported Opcode: 0x" + op.toString(16) + " at position " + this.pos);
            }
        }
        throw new Error("Did not get a picture");
    }

    readDataUint8(len: number) {
        var data = Array(len);
        for (var i = 0; i < len; i++) {
            data[i] = this.readByte();
        }

        return data;
    };
    readData(len: number): DataView {
        var data = new DataView(this.d.buffer, this.d.byteOffset + this.pos, len);
        this.pos += len;
        return data;
    };

    packBitsDecode(valueSize: number, data: DataView) {
        // valueSize is in bytes, byteLength is how many bytes to read
        var result: Array<number> = []; // uint8_t
        var pos = 0;
        var length = data.byteLength;
        if (valueSize > 4) {
            throw new Error("valueSize too large. Must be <= 4 but got " + valueSize);
        }

        var run;
        while (pos < length) {
            var count = data.getUint8(pos);
            pos++;
            this.log("count: " + count);

            if (count < 128) {
                run = (1 + count) * valueSize;
                for (let i = 0; i < run; i++) {
                    result.push(data.getUint8(pos + i));
                }
                pos += run;
            }

            else {
                // Expand the repeat compression
                run = 256 - count;
                var val = [];
                for (let i = 0; i < valueSize; i++) {
                    val.push(data.getUint8(pos + i));
                }
                pos += valueSize;
                for (let i = 0; i <= run; i++) {
                    result = result.concat(val);
                }
            }

        }

        return result;
    };

    parseDirectBitsRect(): PNG {
        var px = this.parsePixMap();
        var sourceRect = this.readWHRect();
        var destinationRect = this.readWHRect();

        // The next 2 bytes represent the "mode" for the direct bits packing. However
        // this doesn't seem to be required with the images included in EV Nova.
        this.pos += 2;

        var raw, pxArray, pxShortArray: Array<number>;

        if (px.packType === 3) {
            raw = Array(px.rowBytes);
            //pxShortArray = Array(sourceRect.height * (px.rowBytes + 1));
        }
        else if (px.packType === 4) {
            raw = Array(Math.floor(px.cmpCount * px.rowBytes / 4));
            //pxArray = Array(Math.floor(sourceRect.height * (px.rowBytes + 3) / 4));
        }
        else {
            throw new Error("Unsupported pack type: " + px.packType);
        }
        pxShortArray = Array(sourceRect.height * (px.rowBytes + 1));
        pxArray = Array(Math.floor(sourceRect.height * (px.rowBytes + 3) / 4));

        var pxBufOffset = 0;
        var packedBytesCount = 0;
        this.log(px);
        for (let scanline = 0; scanline < sourceRect.height; scanline++) {
            // Narrow pictures don't use the pack bits compression. 
            // See (2) Table 5
            // Below 8 bits, it is uncompressed.
            if (px.rowBytes < 8) {
                // gets px.rowBytes number of bytes from d
                // Then, puts sourceRect.width * 2 of them in 'raw'
                var data = this.readDataUint8(px.rowBytes);
                raw = data.slice(0, sourceRect.width * 2);
            }
            else { // Pack bits compression
                if (px.rowBytes > 250) {
                    packedBytesCount = this.readWord();
                }
                else {
                    packedBytesCount = this.readByte();
                }

                var encodedScanLine = this.readData(packedBytesCount);
                var decodedScanLine = [];
                if (px.packType === 3) {
                    decodedScanLine = this.packBitsDecode(2, encodedScanLine);
                }
                else {
                    decodedScanLine = this.packBitsDecode(1, encodedScanLine);
                }
                raw = decodedScanLine.slice(0, sourceRect.width * 2);
            }

            if (px.packType === 3) {
                // Store decoded pixel data
                for (let i = 0; i < sourceRect.width; i++) {
                    pxShortArray[pxBufOffset + i] = ((((0xFF & raw[2 * i]) << 8) >>> 0)
                        | ((0xFF & raw[2 * i + 1]) >>> 0)) >>> 0;
                }
            }
            else {
                if (px.cmpCount === 3) {
                    // RGB Data
                    // >>> 0 so javascript interprets it as unsigned
                    // https://stackoverflow.com/questions/6798111/bitwise-operations-on-32-bit-unsigned-ints
                    for (let i = 0; i < sourceRect.width; i++) {
                        pxArray[pxBufOffset + i] = (0xFF000000
                            | ((raw[i] & 0xFF) << 16)
                            | ((raw[px.bounds.width + i] & 0xFF) << 8)
                            | (raw[2 * px.bounds.width + i] & 0xFF)) >>> 0;
                    }
                }
                else {
                    // ARGB Data
                    for (let i = 0; i < sourceRect.width; i++) {
                        pxArray[pxBufOffset + i] =
                            (((raw[i] & 0xFF) << 24)
                                | ((raw[px.bounds.width + i] & 0xFF) << 16)
                                | ((raw[2 * px.bounds.width + i] & 0xFF) << 8)
                                | (raw[3 * px.bounds.width + i] & 0xFF)) >>> 0;
                    }
                }
            }

            pxBufOffset += sourceRect.width;
        } // Matches for (let scanline...

        // Finally we need to unpack all of the pixel data. This is due to the pixels being
        // stored in an RGB 555 format. CoreGraphics does not expose a way of cleanly/publically
        // parsing this type of encoding so we need to convert it to a more modern
        // representation, such as RGBA 8888

        var sourceLength = destinationRect.width * destinationRect.height;
        var rgbCount = sourceLength * 4;
        var rgbRaw = Array(rgbCount);

        if (px.packType === 3) {
            for (let p = 0, i = 0; i < sourceLength; i++) {
                rgbRaw[p++] = (((pxShortArray[i] & 0x7c00) >>> 10) << 3) >>> 0;
                rgbRaw[p++] = (((pxShortArray[i] & 0x03e0) >>> 5) << 3) >>> 0;
                rgbRaw[p++] = ((pxShortArray[i] & 0x001f) << 3) >>> 0;
                rgbRaw[p++] = 0xFF; // UINT8_MAX
            }
        }
        else {
            for (let p = 0, i = 0; i < sourceLength; i++) {
                rgbRaw[p++] = ((pxArray[i] & 0xFF0000) >>> 16);
                rgbRaw[p++] = (pxArray[i] & 0xFF00) >>> 8;
                rgbRaw[p++] = (pxArray[i] & 0xFF) >>> 0;
                rgbRaw[p++] = (pxArray[i] & 0xFF000000) >>> 24;
            }
        }


        var png = new PNG({ width: sourceRect.width, height: sourceRect.height });
        for (var y = 0; y < png.height; y++) {
            for (var x = 0; x < png.width; x++) {
                var idx = (png.width * y + x) << 2;
                png.data[idx] = rgbRaw[idx];
                png.data[idx + 1] = rgbRaw[idx + 1];
                png.data[idx + 2] = rgbRaw[idx + 2];
                png.data[idx + 3] = rgbRaw[idx + 3];
            }
        }
        return png;

    }

    readRegionWithRect() {
        var size = this.readWord();
        var regionRect = {
            x: this.readWord() / this.xRatio,
            y: this.readWord() / this.yRatio,
            width: (this.readWord() / this.xRatio),
            height: (this.readWord() / this.yRatio)
        };
        regionRect.width -= regionRect.x;
        regionRect.height -= regionRect.y;
        var points = (size - 10) / 4;
        this.pos += 2 * 2 * points;
        return regionRect;
    }
    parsePixMap() {
        return {
            baseAddress: this.reaDWord(),
            rowBytes: (this.readWord() & 0x7FFF) >>> 0,

            bounds: this.readWHRect(),

            pmVersion: this.readWord(),
            packType: this.readWord(),
            packSize: this.reaDWord(),

            hRes: this.readFixedPoint(),
            vRes: this.readFixedPoint(),

            pixelType: this.readWord(),
            pixelSize: this.readWord(),
            cmpCount: this.readWord(),
            cmpSize: this.readWord(),

            planeBytes: this.reaDWord(),
            pmTable: this.reaDWord(),
            pmReserved: this.reaDWord()
        };
    };

    readQDRect() {
        var rect = {
            y1: this.d.getUint16(this.pos),
            x1: this.d.getUint16(this.pos + wordSize),
            y2: this.d.getUint16(this.pos + 2 * wordSize),
            x2: this.d.getUint16(this.pos + 3 * wordSize)
        };
        this.pos += wordSize * 4;
        return rect;
    }
    readWHRect() {
        var r = this.readQDRect();
        return {
            x: r.x1,
            y: r.y1,
            width: r.x2 - r.x1,
            height: r.y2 - r.y1
        };
    };
    readFixedPoint() {
        var point = this.d.getUint32(this.pos) / (1 << 16);
        this.pos += 4;
        return point;
    };
    readByte() {
        var byte = this.d.getUint8(this.pos);
        this.pos++;
        return byte;
    };
    reaDWord() {
        var word = this.d.getUint32(this.pos);
        this.pos += 4;
        return word;
    };
    readWord() {
        var word = this.d.getUint16(this.pos);
        this.pos += 2;
        return word;
    };
    readOpcode() {
        this.pos += this.pos % 2;
        return this.readWord();
    };
    parseLongComment() {
        var kind = this.readWord();
        var length = this.readWord();
        this.pos += length;
    }
    log(_thing: any) {
        //console.log(text);
    }
};


export { PICTParse };

