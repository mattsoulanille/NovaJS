import "jasmine";
import { readResourceFork, ResourceMap } from "resource_fork";
import { RledResource } from "../../src/resource_parsers/rled_resource.js";
import { PNG } from "pngjs";
import { getPNG, getFrames, applyMask, PNGCustomMatchers } from "./png_compare.js"
import { defaultIDSpace } from "./default_id_space.js";
import { ResourceBuilder } from "./resource_builder.js";

declare global {
    namespace jasmine {
        interface Matchers<T> {
            toEqualPNG(expected: unknown): boolean
        }
    }
}

jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000; // 30 seconds

import { resolveFixture } from "../../test/fixtures.js";

describe("RledResource", () => {
    let rf: ResourceMap;
    let starbridge: RledResource;
    let leviathan: RledResource;
    let starbridgePNG: PNG;
    let starbridgeMask: PNG;
    let leviathanPNG: PNG;
    let leviathanMask: PNG;

    // Rleds don't depend on other resources.
    const idSpace = defaultIDSpace;

    beforeEach(async () => {
        jasmine.addMatchers(PNGCustomMatchers);

        starbridgePNG = await getPNG(resolveFixture(
            "resource_examples/rleds/starbridge.png"));
        starbridgeMask = await getPNG(resolveFixture(
            "resource_examples/rleds/starbridge_mask.png"));
        leviathanPNG = await getPNG(resolveFixture(
            "resource_examples/rleds/leviathan.png"));
        leviathanMask = await getPNG(resolveFixture(
            "resource_examples/rleds/leviathan_mask.png"));

        const dataPath = resolveFixture("resource_examples/rled.ndat");
        rf = await readResourceFork(dataPath, false);

        const rleds = rf.rlëD;
        starbridge = new RledResource(rleds[1010], idSpace);
        leviathan = new RledResource(rleds[1006], idSpace);
        expect(starbridge).toBeDefined();
        expect(leviathan).toBeDefined();
    });

    it("should produce an ordered array of frames", () => {
        const starbridgeApplied = applyMask(starbridgePNG, starbridgeMask);
        const leviathanApplied = applyMask(leviathanPNG, leviathanMask);

        const expectedStarbridgeFrames = getFrames(starbridgeApplied, { width: 48, height: 48 });
        const expectedLeviathanFrames = getFrames(leviathanApplied, { width: 144, height: 144 });

        const parsedStarbridgeFrames = starbridge.frames;
        const parsedLeviathanFrames = leviathan.frames

        expect(parsedStarbridgeFrames.length).toEqual(expectedStarbridgeFrames.length);
        expect(parsedLeviathanFrames.length).toEqual(expectedLeviathanFrames.length);

        for (let i = 0; i < parsedStarbridgeFrames.length; i++) {
            expect(expectedStarbridgeFrames[i]).toEqualPNG(parsedStarbridgeFrames[i]);
        }

        for (let i = 0; i < parsedLeviathanFrames.length; i++) {
            expect(expectedLeviathanFrames[i]).toEqualPNG(parsedLeviathanFrames[i]);
        }
    });
});

/**
 * Opcode 4 (PixelRun) carries its own two 16-bit colours in the 32-bit
 * run value; the decoder used to ignore them and paint the run with the
 * last PixelData colour instead. Stock data barely shows it (nova:1930,
 * the Thunderforge weapon glow, is the only stock sheet with runs), but
 * ResForge/EVNEW emit runs for every solid area, so plug-in planets and
 * hulls decoded with smeared colour bands.
 */
describe("RledResource PixelRun (opcode 4)", () => {
    const RED = 0x7C00;   // 1:5:5:5 — all red bits.
    const GREEN = 0x03E0;
    const BLUE = 0x001F;

    function rgba(png: PNG, x: number): number[] {
        return [...png.data.subarray(x * 4, x * 4 + 4)];
    }

    it("paints a run with the run's own colours, high half first", () => {
        // 4x1, 16 bpp, one frame; data starts at byte 16.
        const rled = new ResourceBuilder()
            .uint16(4).uint16(1).uint16(16).uint16(0).uint16(1).skip(6)
            .uint32(0x01000000)               // LineStart
            .uint32(0x02000000 | 2).uint16(RED).uint16(0)  // one pixel + pad
            .uint32(0x04000000 | 4)           // PixelRun, 4 bytes = 2 px
            .uint32((GREEN << 16) | BLUE)     // the run's two colours
            .uint32(0x00000000)               // EndOfFrame
            .resource("rlëD", 500);
        const frames = new RledResource(rled, defaultIDSpace).frames;
        expect(frames.length).toEqual(1);
        const frame = frames[0];
        expect(rgba(frame, 0)).toEqual([255, 0, 0, 255]);
        // The run: NOT the stale red PixelData pixel.
        expect(rgba(frame, 1)).toEqual([0, 255, 0, 255]);
        expect(rgba(frame, 2)).toEqual([0, 0, 255, 255]);
        // Untouched by either opcode: transparent.
        expect(rgba(frame, 3)).toEqual([0, 0, 0, 0]);
    });

    it("paints a run at frame start, where no PixelData colour exists", () => {
        const rled = new ResourceBuilder()
            .uint16(2).uint16(1).uint16(16).uint16(0).uint16(1).skip(6)
            .uint32(0x01000000)
            .uint32(0x04000000 | 4).uint32(0x7FFF7FFF)   // 2 white px
            .uint32(0x00000000)
            .resource("rlëD", 501);
        const frame = new RledResource(rled, defaultIDSpace).frames[0];
        expect(rgba(frame, 0)).toEqual([255, 255, 255, 255]);
        expect(rgba(frame, 1)).toEqual([255, 255, 255, 255]);
    });
});
