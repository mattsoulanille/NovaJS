/**
 * Easy-to-track ship graphics for experiment plug-ins: a solid disc of
 * one exact colour on every rotation frame, so an analysis script can
 * find a ship's centre in a recording by colour alone (the centroid of
 * the disc's pixels is the ship's position, whatever its heading).
 *
 * discShipGraphics() returns the rlëD sprite sheet and the shän that points
 * at it. A shïp uses the shän with its own id, so a plug-in adds
 * { type: "shän", id: shipId } and { type: "rlëD", id: rledId }.
 */
import { ByteWriter } from "../synthetic/byte_writer.js";
import { RasterFrame, rgb15, TRANSPARENT } from "../synthetic/raster.js";
import { encodeRled } from "../synthetic/rled.js";

const NONE = -1;

/** A filled disc, `size` x `size`, of one 15-bit colour (r, g, b 0-31). */
export function discFrame(size: number, rgb: [number, number, number],
    diameter = size - 2): RasterFrame {
    const colour = rgb15(...rgb);
    const c = (size - 1) / 2;
    const r = diameter / 2;
    const pixels: number[] = [];
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            pixels.push((x - c) ** 2 + (y - c) ** 2 <= r * r ? colour : TRANSPARENT);
        }
    }
    return { width: size, height: size, pixels };
}

/** The shän layout of src/synthetic/resources.ts, for a base image only. */
export function shanForSprite(baseImage: number, size: number, framesPer: number): number[] {
    const w = new ByteWriter();
    // Every stock shän names a mask id (sprite id + 1, never an existing
    // resource) rather than -1; do the same.
    const image = (id: number, setCount: boolean) => {
        w.int16(id).int16(id === NONE ? NONE : id + 1);
        if (setCount) {
            w.int16(id === NONE ? 0 : 1);
        }
        w.int16(id === NONE ? 0 : size).int16(id === NONE ? 0 : size);
    };
    image(baseImage, true);
    w.int16(0); // Base transparency.
    image(NONE, true); // Alt image.
    image(NONE, false); // Engine glow.
    image(NONE, false); // Running lights.
    image(NONE, false); // Weapon flash.
    w.uint16(0) // Flags.
        .int16(0).int16(0) // AnimDelay, WeapDecay.
        .int16(framesPer)
        .int16(NONE).int16s(4, [], 0); // Blink mode and values.
    image(NONE, false); // Shield.
    for (let i = 0; i < 4; i++) {
        w.int16s(4, [], 0).int16s(4, [], 0); // Exit points (x, y) per type.
    }
    w.int16(100).int16(100).int16(100).int16(100); // Up/down compress.
    for (let i = 0; i < 4; i++) {
        w.int16s(4, [], 0); // Exit point z per type.
    }
    return w.expect(176).padTo(192).toArray();
}

/**
 * rlëD + shän bytes for a solid-disc ship: `frames` identical frames (36,
 * one per 10 degrees, like a stock ship sheet). `diameter` draws the disc
 * smaller than its `size` x `size` frame (default: fills it, less a 1 px
 * rim), to tell frame size from visible size apart.
 */
export function discShipGraphics(rledId: number, rgb: [number, number, number],
    size = 24, frames = 36, diameter = size - 2): { rled: number[], shan: number[] } {
    const frame = discFrame(size, rgb, diameter);
    return {
        rled: encodeRled(Array.from({ length: frames }, () => frame), { original: true }),
        shan: shanForSprite(rledId, size, frames),
    };
}
