import "jasmine";
import { Resource } from "resource_fork";
import { RledResource } from "../../src/resource_parsers/rled_resource.js";
import { PictResource } from "../../src/resource_parsers/pict_resource.js";
import { CicnResource } from "../../src/resource_parsers/cicn_resource.js";
import { defaultIDSpace } from "../resource_parsers/default_id_space.js";
import { encodeRled } from "../../src/synthetic/rled.js";
import { encodePict, packBits, placeholderImage } from "../../src/synthetic/pict.js";
import { encodeCicn } from "../../src/synthetic/cicn.js";
import {
    circle, polygon, rasterize, rgb15, rotation, rotationFrames, TRANSPARENT,
} from "../../src/synthetic/raster.js";
import { ByteWriter } from "../../src/synthetic/byte_writer.js";

/**
 * The synthetic set's encoders against the parsers they target. Each
 * parser is the format's oracle: what the encoder writes must come back
 * from it pixel for pixel.
 */
const resource = (type: string, bytes: number[]) =>
    new Resource(type, 128, "test", new DataView(new Uint8Array(bytes).buffer));

describe("encodeRled", () => {
    const RED = rgb15(31, 0, 0);
    const BLUE = rgb15(0, 0, 31);

    it("round-trips transparent runs, solid runs and lone pixels through "
        + "RledResource", () => {
            // Row 0: transparent, solid run, transparent tail.
            // Row 1: lone pixels of alternating colour (literal data), odd
            // count so the literal needs padding.
            // Row 2: entirely transparent.
            const frame = {
                width: 6, height: 3,
                pixels: [
                    TRANSPARENT, RED, RED, RED, TRANSPARENT, TRANSPARENT,
                    RED, BLUE, RED, TRANSPARENT, BLUE, BLUE,
                    TRANSPARENT, TRANSPARENT, TRANSPARENT, TRANSPARENT, TRANSPARENT, TRANSPARENT,
                ],
            };
            const rled = new RledResource(resource("rlëD", encodeRled([frame, frame])),
                defaultIDSpace);
            expect(rled.size).toEqual([6, 3]);
            expect(rled.bitsPerPixel).toEqual(16);
            expect(rled.numberOfFrames).toEqual(2);
            const frames = rled.frames;
            expect(frames.length).toEqual(2);
            const rgba = (x: number, y: number) =>
                [...frames[1].data.slice((y * 6 + x) * 4, (y * 6 + x) * 4 + 4)];
            expect(rgba(0, 0)).toEqual([0, 0, 0, 0]);
            expect(rgba(1, 0)).toEqual([255, 0, 0, 255]);
            expect(rgba(3, 0)).toEqual([255, 0, 0, 255]);
            expect(rgba(4, 0)).toEqual([0, 0, 0, 0]);
            expect(rgba(0, 1)).toEqual([255, 0, 0, 255]);
            expect(rgba(1, 1)).toEqual([0, 0, 255, 255]);
            expect(rgba(2, 1)).toEqual([255, 0, 0, 255]);
            expect(rgba(3, 1)).toEqual([0, 0, 0, 0]);
            expect(rgba(5, 1)).toEqual([0, 0, 255, 255]);
            expect(rgba(2, 2)).toEqual([0, 0, 0, 0]);
        });

    it("refuses frames of different sizes", () => {
        const a = { width: 2, height: 1, pixels: [RED, RED] };
        const b = { width: 1, height: 1, pixels: [RED] };
        expect(() => encodeRled([a, b])).toThrowError(/one size/);
    });
});

describe("the integer rasterizer", () => {
    it("rotates clockwise from nose-up in exact tenth-turn steps", () => {
        expect(rotation(0)).toEqual({ cos: 1024, sin: 0 });
        expect(rotation(9)).toEqual({ cos: 0, sin: 1024 });
        expect(rotation(18)).toEqual({ cos: -1024, sin: 0 });
        expect(rotation(27)).toEqual({ cos: 0, sin: -1024 });
        expect(rotation(3)).toEqual({ cos: 887, sin: 512 });
        expect(rotation(33)).toEqual({ cos: 887, sin: -512 });

        // A nose-up arrow in an odd-sized frame (so a pixel centre sits
        // on the axis): tip at the top in frame 0, at the right a quarter
        // turn later.
        const arrow = [polygon(1, [[0, -8], [3, 5], [-3, 5]])];
        const up = rasterize(9, 9, arrow);
        const right = rasterize(9, 9, arrow, 9);
        const at = (frame: { pixels: number[] }, x: number, y: number) =>
            frame.pixels[y * 9 + x];
        expect(at(up, 4, 0)).toEqual(1);
        expect(at(up, 4, 8)).toEqual(TRANSPARENT);
        expect(at(right, 8, 4)).toEqual(1);
        expect(at(right, 0, 4)).toEqual(TRANSPARENT);
    });

    it("is a pure function of its inputs", () => {
        const shapes = [circle(2, [0, 0], 9), polygon(3, [[0, -10], [4, 4], [-4, 4]])];
        const a = rotationFrames(12, 12, shapes, 36);
        const b = rotationFrames(12, 12, shapes, 36);
        expect(a).toEqual(b);
        expect(a.length).toEqual(36);
    });

    it("lets a transparent shape cut a hole", () => {
        const ring = rasterize(10, 10, [circle(1, [0, 0], 9), circle(TRANSPARENT, [0, 0], 4)]);
        expect(ring.pixels[5 * 10 + 5]).toEqual(TRANSPARENT);
        expect(ring.pixels[5 * 10 + 1]).toEqual(1);
    });
});

describe("encodePict", () => {
    it("round-trips an indexed picture through PictResource", () => {
        const image = placeholderImage(20, 12, 0x102030, 0xf0f0f0);
        const pict = new PictResource(resource("PICT", encodePict(image)), defaultIDSpace);
        const png = pict.png;
        expect([png.width, png.height]).toEqual([20, 12]);
        const at = (x: number, y: number) =>
            [...png.data.slice((y * 20 + x) * 4, (y * 20 + x) * 4 + 4)];
        expect(at(0, 0)).toEqual([0xf0, 0xf0, 0xf0, 255]);
        expect(at(10, 3)).toEqual([0x10, 0x20, 0x30, 255]);
        expect(at(19, 11)).toEqual([0xf0, 0xf0, 0xf0, 255]);
    });

    it("packs runs and literals the way pict_parse unpacks them", () => {
        expect(packBits([7, 7, 7, 7])).toEqual([253, 7]);
        expect(packBits([1, 2, 3])).toEqual([2, 1, 2, 3]);
        expect(packBits([1, 2, 2, 2, 3])).toEqual([0, 1, 254, 2, 0, 3]);
        expect(packBits(new Array(130).fill(9))).toEqual([129, 9, 255, 9]);
    });
});

describe("encodeCicn", () => {
    it("round-trips an icon and its mask through CicnResource", () => {
        const width = 5;
        const height = 3;
        const indices = [0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0];
        const mask = indices.map(i => i === 1);
        const cicn = new CicnResource(resource("cicn", encodeCicn(
            { width, height, palette: [0x000000, 0x00ff00], indices }, mask)),
            defaultIDSpace);
        expect([cicn.width, cicn.height]).toEqual([5, 3]);
        const px = (x: number, y: number) =>
            [...cicn.pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];
        expect(px(0, 0)).toEqual([0, 0, 0, 0]);
        expect(px(1, 0)).toEqual([0, 255, 0, 255]);
        expect(px(2, 1)).toEqual([0, 255, 0, 255]);
        expect(px(1, 1)).toEqual([0, 0, 0, 0]);
    });
});

describe("ByteWriter", () => {
    it("writes MacRoman text, Pascal strings and 64-bit fields big-endian", () => {
        const bytes = new ByteWriter().string("ë", 3).pstring("ab").uint64(0x0102n)
            .int16(-1).toArray();
        expect(bytes).toEqual([0x91, 0, 0, 2, 97, 98, 0, 0, 0, 0, 0, 0, 1, 2, 0xff, 0xff]);
    });

    it("refuses text that does not leave room for its terminator", () => {
        expect(() => new ByteWriter().string("abc", 3)).toThrowError(/does not fit/);
    });

    it("refuses to pad a resource that is already too long", () => {
        expect(() => new ByteWriter().zeros(5).padTo(4)).toThrowError(/5 bytes/);
    });
});
