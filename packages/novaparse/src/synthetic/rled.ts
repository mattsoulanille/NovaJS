import { ByteWriter } from "./byte_writer.js";
import { RasterFrame, TRANSPARENT } from "./raster.js";

/**
 * Encodes frames as a 16-bit rlëD sprite resource, the inverse of
 * resource_parsers/rled_resource.ts (which is the format's oracle here):
 *
 *   header (16 bytes): width, height, depth (16), reserved, frame count,
 *       6 reserved bytes;
 *   then per frame, per row: a LineStart opcode, the row as transparent
 *   runs (opcode 3), solid-colour runs (opcode 4, the two 16-bit halves of
 *   its 32-bit argument both the colour, like every run in the stock
 *   files) and literal pixel data (opcode 2, padded to four bytes); and an
 *   EndOfFrame opcode (0) after the last row of each frame.
 *
 * Every opcode is a 32-bit word: the top byte is the opcode, the low 24
 * bits a byte count (two bytes per 16-bit pixel).
 */
export function encodeRled(frames: readonly RasterFrame[]): number[] {
    if (frames.length === 0) {
        throw new Error("An rlëD needs at least one frame");
    }
    const { width, height } = frames[0];
    const w = new ByteWriter();
    w.uint16(width).uint16(height).uint16(16).uint16(0)
        .uint16(frames.length).zeros(6);

    const opcode = (code: number, byteCount: number) =>
        w.uint32(((code << 24) | byteCount) >>> 0);

    for (const frame of frames) {
        if (frame.width !== width || frame.height !== height) {
            throw new Error("Every frame of an rlëD shares one size");
        }
        for (let y = 0; y < height; y++) {
            opcode(1, 0); // LineStart
            const row = frame.pixels.slice(y * width, (y + 1) * width);
            let x = 0;
            while (x < width) {
                const start = x;
                const color = row[x];
                while (x < width && row[x] === color) {
                    x++;
                }
                const run = x - start;
                if (color === TRANSPARENT) {
                    opcode(3, 2 * run); // TransparentRun
                } else if (run >= 2) {
                    opcode(4, 2 * run); // PixelRun
                    w.uint16(color).uint16(color);
                } else {
                    // A lone pixel: gather the following singletons into
                    // one literal chunk rather than a run each.
                    let end = x;
                    while (end < width && row[end] !== TRANSPARENT
                        && (end + 1 >= width || row[end + 1] !== row[end])) {
                        end++;
                    }
                    const literal = row.slice(start, end);
                    opcode(2, 2 * literal.length); // PixelData
                    for (const pixel of literal) {
                        w.uint16(pixel);
                    }
                    if ((2 * literal.length) % 4 !== 0) {
                        w.zeros(2);
                    }
                    x = end;
                }
            }
        }
        opcode(0, 0); // EndOfFrame
    }
    return w.toArray();
}
