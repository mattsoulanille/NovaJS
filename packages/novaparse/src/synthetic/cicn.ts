import { ByteWriter } from "./byte_writer.js";
import { IndexedImage } from "./pict.js";

/**
 * Encodes an 8-bit indexed icon as a classic Mac 'cicn' colour icon, the
 * layout resource_parsers/cicn_resource.ts reads:
 *
 *   PixMap record (50 bytes), mask BitMap (14), icon BitMap (14), icon
 *   data handle (4); then the 1-bit mask rows, the 1-bit icon rows, the
 *   ColorTable and the 8-bit pixel rows.
 *
 * `mask` marks the opaque pixels (row-major booleans); the 1-bit icon
 * bitmap, which nothing reads, is a copy of the mask.
 */
export function encodeCicn(image: IndexedImage, mask: readonly boolean[]): number[] {
    const { width, height, palette, indices } = image;
    if (mask.length !== width * height || indices.length !== width * height) {
        throw new Error("Mask and index map must match the icon size");
    }
    const pmRowBytes = width + (width % 2);
    const bitRowBytes = Math.ceil(width / 8) + (Math.ceil(width / 8) % 2);

    const w = new ByteWriter();
    const bounds = () => w.int16(0).int16(0).int16(height).int16(width);
    // PixMap.
    w.uint32(0).uint16(0x8000 | pmRowBytes);
    bounds();
    w.uint16(0).uint16(0).uint32(0) // pmVersion, packType, packSize
        .uint32(0x00480000).uint32(0x00480000) // hRes, vRes
        .uint16(0).uint16(8).uint16(1).uint16(8) // pixelType, pixelSize, cmpCount, cmpSize
        .uint32(0).uint32(0).uint32(0); // planeBytes, pmTable, pmReserved
    // Mask and icon BitMaps, then the icon data handle.
    for (let i = 0; i < 2; i++) {
        w.uint32(0).uint16(bitRowBytes);
        bounds();
    }
    w.uint32(0);
    w.expect(50 + 14 + 14 + 4);

    const bitRows = () => {
        for (let y = 0; y < height; y++) {
            const row = new Array<number>(bitRowBytes).fill(0);
            for (let x = 0; x < width; x++) {
                if (mask[y * width + x]) {
                    row[x >> 3] |= 0x80 >> (x & 7);
                }
            }
            w.raw(row);
        }
    };
    bitRows(); // Mask.
    bitRows(); // 1-bit icon (unused).

    // ColorTable: seed, flags (0x8000: index-ordered), size-1, entries.
    w.uint32(0).uint16(0x8000).uint16(palette.length - 1);
    palette.forEach((rgb, i) => {
        w.uint16(i)
            .uint16(((rgb >> 16) & 0xff) * 0x101)
            .uint16(((rgb >> 8) & 0xff) * 0x101)
            .uint16((rgb & 0xff) * 0x101);
    });

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < pmRowBytes; x++) {
            w.uint8(x < width ? indices[y * width + x] : 0);
        }
    }
    return w.toArray();
}
