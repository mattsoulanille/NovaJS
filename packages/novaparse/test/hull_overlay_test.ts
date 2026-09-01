import "jasmine";
import { PNG } from "pngjs";
import {
    makeHullOverlayMap, overlayFramesForBaseFrame,
} from "../src/parsers/hull_overlay_map.js";
import { makeHulls, unionMask } from "../src/parsers/sprite_sheet_multi_parse.js";
import { NovaResources } from "../src/resource_parsers/resource_holder_base.js";
import { Mask } from "../src/hull/trace_outline.js";
import { Point } from "../src/hull/convex_decomposition.js";

/**
 * A shän as makeHullOverlayMap reads it: base/alt image local ids,
 * FramesPer, and the prefix-local rlëD view those ids resolve through.
 */
function fakeShan(baseLocalId: number, altLocalId: number | null,
    framesPer: number, rledPrefix = "nova") {
    const rlëD: { [index: string]: { globalID: string } } = {};
    for (const localId of [baseLocalId, altLocalId]) {
        if (localId !== null) {
            rlëD[localId] = { globalID: `${rledPrefix}:${localId}` };
        }
    }
    return {
        framesPer,
        images: {
            baseImage: { ID: baseLocalId },
            altImage: altLocalId === null ? null : { ID: altLocalId },
        },
        idSpace: { rlëD },
    };
}

function fakeIdSpace(shans: { [globalId: string]: unknown }): NovaResources {
    return { shän: shans } as unknown as NovaResources;
}

describe("makeHullOverlayMap (base sprite sheet -> alt sprite sheet)", () => {
    it("attaches a shän's alt image to its base image", () => {
        // The shape of the real Aurora Thunderforge (shän nova:380):
        // base rlëD 1130, alt rlëD 1330, 64 frames per rotation.
        const map = makeHullOverlayMap(fakeIdSpace({
            "nova:380": fakeShan(1130, 1330, 64),
        }));
        expect(map).toEqual({
            "nova:1130": { overlayId: "nova:1330", framesPer: 64 },
        });
    });

    it("leaves a shän with no alt image alone", () => {
        const map = makeHullOverlayMap(fakeIdSpace({
            "nova:164": fakeShan(1072, null, 36),
        }));
        expect(map).toEqual({});
    });

    it("shares one overlay across shäns that agree", () => {
        // Stock Nova reuses a base sheet across many shäns (rlëD nova:1048
        // backs sixteen of them), so agreeing duplicates are the norm.
        const map = makeHullOverlayMap(fakeIdSpace({
            "nova:380": fakeShan(1130, 1330, 64),
            "nova:381": fakeShan(1130, 1330, 64),
        }));
        expect(map["nova:1130"])
            .toEqual({ overlayId: "nova:1330", framesPer: 64 });
    });

    // A hull is cached per rlëD, so one base sheet cannot carry two
    // different overlays. Rather than inflate the hitboxes of every ship
    // sharing the sheet, drop the overlay entirely.
    it("drops the overlay when two shäns share a base sheet but disagree",
        () => {
            expect(makeHullOverlayMap(fakeIdSpace({
                "nova:380": fakeShan(1130, 1330, 64),
                "nova:381": fakeShan(1130, 1400, 64),
            }))).toEqual({});

            // One with, one without: still a disagreement.
            expect(makeHullOverlayMap(fakeIdSpace({
                "nova:380": fakeShan(1130, 1330, 64),
                "nova:381": fakeShan(1130, null, 64),
            }))).toEqual({});

            // Same sheet, different rotation granularity.
            expect(makeHullOverlayMap(fakeIdSpace({
                "nova:380": fakeShan(1130, 1330, 64),
                "nova:381": fakeShan(1130, 1330, 36),
            }))).toEqual({});
        });

    it("ignores an alt image whose rlëD is missing", () => {
        const shan = fakeShan(1130, 1330, 64);
        delete (shan.idSpace.rlëD as { [k: string]: unknown })[1330];
        expect(makeHullOverlayMap(fakeIdSpace({ "nova:380": shan })))
            .toEqual({});
    });

    it("ignores a shän with no frames per rotation", () => {
        // FramesPer 0 would make every heading map to the same overlay
        // frame set; there is nothing sensible to union.
        expect(makeHullOverlayMap(fakeIdSpace({
            "nova:380": fakeShan(1130, 1330, 0),
        }))).toEqual({});
    });

    it("does not depend on the order shäns are visited in", () => {
        const forwards = makeHullOverlayMap(fakeIdSpace({
            "nova:380": fakeShan(1130, 1330, 64),
            "nova:381": fakeShan(1140, null, 36),
        }));
        const backwards = makeHullOverlayMap(fakeIdSpace({
            "nova:381": fakeShan(1140, null, 36),
            "nova:380": fakeShan(1130, 1330, 64),
        }));
        expect(forwards).toEqual(backwards);
    });
});

/**
 * The overlay's animation set is chosen by the clock (or by fold
 * progress), never by the ship's heading, while a hull is indexed by
 * heading alone. So the hull for one heading has to cover the overlay's
 * whole spin cycle at that heading.
 */
describe("overlayFramesForBaseFrame (union over the spin cycle)", () => {
    it("takes the same heading out of every set", () => {
        // The Thunderforge: 6 sets of 64.
        expect(overlayFramesForBaseFrame(0, 64, 384))
            .toEqual([0, 64, 128, 192, 256, 320]);
        expect(overlayFramesForBaseFrame(17, 64, 384))
            .toEqual([17, 81, 145, 209, 273, 337]);
        expect(overlayFramesForBaseFrame(63, 64, 384))
            .toEqual([63, 127, 191, 255, 319, 383]);
    });

    it("reduces a multi-set BASE frame to its heading", () => {
        // A base sheet with several sets of its own (a folding ship)
        // still only ever presents headings 0..framesPer-1 to collision,
        // but the mapping must hold for the whole sheet regardless.
        expect(overlayFramesForBaseFrame(64 + 5, 64, 384))
            .toEqual(overlayFramesForBaseFrame(5, 64, 384));
    });

    it("degenerates to a single-set overlay", () => {
        expect(overlayFramesForBaseFrame(3, 64, 64)).toEqual([3]);
    });

    it("returns nothing for a degenerate sheet", () => {
        expect(overlayFramesForBaseFrame(0, 0, 384)).toEqual([]);
        expect(overlayFramesForBaseFrame(0, 64, 0)).toEqual([]);
    });

    it("covers every overlay frame exactly once across all headings", () => {
        const seen = new Set<number>();
        for (let heading = 0; heading < 64; heading++) {
            for (const frame of overlayFramesForBaseFrame(heading, 64, 384)) {
                expect(seen.has(frame)).toBeFalse();
                seen.add(frame);
            }
        }
        expect(seen.size).toBe(384);
    });
});

function boxMask(width: number, height: number,
    box: { x: number, y: number, w: number, h: number }): Mask {
    return {
        width, height,
        isFilled: (x, y) => x >= box.x && x < box.x + box.w
            && y >= box.y && y < box.y + box.h,
    };
}

describe("unionMask (stacking sprite layers for one hull)", () => {
    it("keeps a lone mask unchanged", () => {
        const mask = boxMask(8, 8, { x: 1, y: 1, w: 2, h: 2 });
        const union = unionMask([mask]);
        expect([union.width, union.height]).toEqual([8, 8]);
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                expect(union.isFilled(x, y)).toBe(mask.isFilled(x, y));
            }
        }
    });

    it("fills a pixel solid in any layer", () => {
        const union = unionMask([
            boxMask(8, 8, { x: 0, y: 0, w: 2, h: 2 }),
            boxMask(8, 8, { x: 6, y: 6, w: 2, h: 2 }),
        ]);
        expect(union.isFilled(0, 0)).toBeTrue();
        expect(union.isFilled(7, 7)).toBeTrue();
        expect(union.isFilled(4, 4)).toBeFalse();
    });

    it("centres layers of different sizes on each other", () => {
        // The display anchors every layer of a ship at its own centre, so
        // a smaller sheet sits in the middle of a larger one.
        const big = boxMask(8, 8, { x: 0, y: 0, w: 0, h: 0 });
        const small = boxMask(4, 4, { x: 0, y: 0, w: 4, h: 4 });
        const union = unionMask([big, small]);
        expect([union.width, union.height]).toEqual([8, 8]);
        expect(union.isFilled(2, 2)).toBeTrue();
        expect(union.isFilled(5, 5)).toBeTrue();
        expect(union.isFilled(1, 1)).toBeFalse();
        expect(union.isFilled(6, 6)).toBeFalse();
    });

    it("reports nothing outside its bounds", () => {
        const union = unionMask([boxMask(4, 4, { x: 0, y: 0, w: 4, h: 4 })]);
        expect(union.isFilled(-1, 0)).toBeFalse();
        expect(union.isFilled(0, 4)).toBeFalse();
    });
});

/** A frame with a solid opaque rectangle, everything else transparent. */
function framePNG(size: number,
    boxes: Array<{ x: number, y: number, w: number, h: number }>): PNG {
    const png = new PNG({ width: size, height: size, filterType: 4 });
    png.data.fill(0);
    for (const box of boxes) {
        for (let y = box.y; y < box.y + box.h; y++) {
            for (let x = box.x; x < box.x + box.w; x++) {
                const i = (size * y + x) * 4;
                png.data[i] = png.data[i + 1] = png.data[i + 2] = 255;
                png.data[i + 3] = 255;
            }
        }
    }
    return png;
}

function inPolygon(polygon: Point[], [x, y]: Point): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, yi] = polygon[i];
        const [xj, yj] = polygon[j];
        if ((yi > y) !== (yj > y) &&
            x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
            inside = !inside;
        }
    }
    return inside;
}
const inSomeComponent = (hull: Point[][], point: Point) =>
    hull.some(component => inPolygon(component, point));

describe("makeHulls (base sheet + overlay -> one hull per heading)", () => {
    // Miniature Thunderforge: the base sheet is a fore and an aft block
    // with a gap between them, and the overlay fills the gap. traceOutline
    // keeps only the largest connected region, so base-alone loses a whole
    // half of the ship on top of missing the middle.
    const foreAndAft = () => framePNG(32,
        [{ x: 12, y: 4, w: 8, h: 6 }, { x: 12, y: 22, w: 8, h: 6 }]);
    const middle = () => framePNG(32, [{ x: 10, y: 11, w: 12, h: 10 }]);

    it("leaves the middle uncovered without the overlay", () => {
        const hulls = makeHulls([foreAndAft()]);
        // Centre of the sprite, in the centred y-up hull frame.
        expect(inSomeComponent(hulls[0], [0, 0])).toBeFalse();
    });

    it("covers the middle once the overlay is unioned in", () => {
        const hulls = makeHulls([foreAndAft()],
            { frames: [middle()], framesPer: 1 });
        expect(hulls.length).toBe(1);
        expect(inSomeComponent(hulls[0], [0, 0])).toBeTrue();
    });

    it("unions every set of the overlay into each heading's hull", () => {
        // Two headings, two overlay sets: the first set sticks out to the
        // left, the second to the right. A hull for either heading has to
        // contain both, because the set on screen is time-driven.
        const base = [foreAndAft(), foreAndAft()];
        const drum = { x: 10, y: 11, w: 12, h: 10 };
        const left = framePNG(32, [drum, { x: 2, y: 14, w: 12, h: 4 }]);
        const right = framePNG(32, [drum, { x: 18, y: 14, w: 12, h: 4 }]);
        const hulls = makeHulls(base,
            // Frames [set0-heading0, set0-heading1, set1-heading0, ...].
            { frames: [left, left, right, right], framesPer: 2 });
        expect(hulls.length).toBe(2);
        for (const hull of hulls) {
            expect(inSomeComponent(hull, [-10, 0])).toBeTrue();
            expect(inSomeComponent(hull, [10, 0])).toBeTrue();
        }
    });

    it("is unchanged by an empty overlay", () => {
        const withoutOverlay = makeHulls([foreAndAft()]);
        const withEmpty = makeHulls([foreAndAft()],
            { frames: [], framesPer: 64 });
        expect(withEmpty).toEqual(withoutOverlay);
    });
});
