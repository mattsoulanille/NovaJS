import { ByteWriter } from "./byte_writer.js";

/** An 8-bit indexed image: a palette of 0xRRGGBB and a row-major index map. */
export interface IndexedImage {
    width: number;
    height: number;
    palette: readonly number[];
    /** Palette index per pixel, row-major, width * height long. */
    indices: readonly number[];
}

/**
 * A flat `fill`-coloured picture with a `border`-coloured one-pixel frame
 * and a diagonal of the border colour through it, so a picture is
 * recognisably a picture (and recognisably which) rather than a blank.
 */
export function placeholderImage(width: number, height: number,
    fill: number, border: number): IndexedImage {
    const indices: number[] = [];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
            // The diagonal, scaled to the picture's aspect.
            const diagonal = Math.floor(x * height / width) === y;
            indices.push(edge || diagonal ? 1 : 0);
        }
    }
    return { width, height, palette: [fill, border], indices };
}

/**
 * Encodes an indexed image as a QuickDraw version 2 PICT that
 * resource_parsers/pict_parse.ts decodes: the v2 header, an extended
 * (0x0C00) header, a clip region, then ONE packBitsRect (0x0098) opcode
 * carrying an 8-bit indexed PixMap with an explicit colour table and
 * PackBits-compressed rows, and the end-of-picture opcode.
 *
 * Row bytes are kept under 251 so each packed row is prefixed by a
 * one-byte length, and even (QuickDraw's rule), which for 8-bit pixels
 * means the width is rounded up to even.
 */
export function encodePict(image: IndexedImage): number[] {
    const { width, height, palette, indices } = image;
    if (indices.length !== width * height) {
        throw new Error("Index map does not match the image size");
    }
    if (palette.length < 1 || palette.length > 256) {
        throw new Error("An 8-bit PICT palette holds 1-256 colours");
    }
    const rowBytes = width + (width % 2);
    if (rowBytes > 250) {
        throw new Error("Placeholder PICTs are kept narrower than 251 bytes a row");
    }

    const w = new ByteWriter();
    w.uint16(0); // Picture size (unused since PICT 2; low word only).
    const rect = () => w.int16(0).int16(0).int16(height).int16(width);
    rect(); // Picture frame.
    w.uint16(0x0011).uint16(0x02ff); // Version 2.
    // Extended header: version -2 (0xFFFE), reserved, hRes, vRes (72 dpi
    // as 16.16 fixed), source rect, reserved.
    w.uint16(0x0c00).uint16(0xfffe).uint16(0)
        .uint32(0x00480000).uint32(0x00480000);
    rect();
    w.uint32(0);
    // Clip region: a bare 10-byte rectangle region.
    w.uint16(0x0001).uint16(10);
    rect();

    w.uint16(0x0098); // packBitsRect
    w.uint16(0x8000 | rowBytes); // rowBytes with the "is a PixMap" flag.
    rect(); // PixMap bounds.
    w.uint16(0) // pmVersion
        .uint16(0) // packType (default PackBits for indexed)
        .uint32(0) // packSize
        .uint32(0x00480000).uint32(0x00480000) // hRes, vRes
        .uint16(0) // pixelType: indexed
        .uint16(8) // pixelSize
        .uint16(1) // cmpCount
        .uint16(8) // cmpSize
        .uint32(0).uint32(0).uint32(0); // planeBytes, pmTable, pmReserved
    // Colour table: seed, flags (0x8000: entries in index order), size-1.
    w.uint32(0).uint16(0x8000).uint16(palette.length - 1);
    palette.forEach((rgb, i) => {
        w.uint16(i)
            .uint16(((rgb >> 16) & 0xff) * 0x101)
            .uint16(((rgb >> 8) & 0xff) * 0x101)
            .uint16((rgb & 0xff) * 0x101);
    });
    rect(); // Source rect.
    rect(); // Destination rect.
    w.uint16(0); // Transfer mode: srcCopy.

    for (let y = 0; y < height; y++) {
        const row: number[] = [];
        for (let x = 0; x < rowBytes; x++) {
            row.push(x < width ? indices[y * width + x] : 0);
        }
        const packed = packBits(row);
        w.uint8(packed.length).raw(packed);
    }
    if (w.length % 2 !== 0) {
        w.uint8(0); // Opcodes are word-aligned.
    }
    w.uint16(0x00ff); // End of picture.
    return w.toArray();
}

/**
 * Apple PackBits: a header byte n in 0-127 introduces n+1 literal bytes;
 * n in 129-255 repeats the next byte 257-n times. 128 is unused.
 */
export function packBits(bytes: readonly number[]): number[] {
    const out: number[] = [];
    let i = 0;
    while (i < bytes.length) {
        // A run of at least two identical bytes.
        let run = 1;
        while (i + run < bytes.length && bytes[i + run] === bytes[i] && run < 128) {
            run++;
        }
        if (run >= 2) {
            out.push(257 - run, bytes[i]);
            i += run;
            continue;
        }
        // Literals up to the next run (or 128 bytes).
        let end = i + 1;
        while (end < bytes.length && end - i < 128
            && !(end + 1 < bytes.length && bytes[end + 1] === bytes[end])) {
            end++;
        }
        out.push(end - i - 1, ...bytes.slice(i, end));
        i = end;
    }
    return out;
}
