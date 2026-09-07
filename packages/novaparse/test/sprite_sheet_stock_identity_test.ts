import "jasmine";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import { getDefaultConvexHull } from "novadatainterface/sprite_sheet_data";
import { fixturesDir } from "./fixtures.js";
import { NovaParse } from "../src/nova_parse.js";
import { Mask } from "../src/hull/trace_outline.js";
import { makeConvexHull } from "../src/parsers/sprite_sheet_multi_parse.js";

/**
 * Collision hulls are hashed simulation input: every peer of a networked
 * game must derive the same geometry from the same sprite, and a saved
 * game's checksum must survive a rebuild. So the sprite-sheet pipeline's
 * output over the stock data is pinned here, byte for byte, and the
 * fallback convex hull is held to an exact vertex order. That order was
 * first the one hull.js (concavity Infinity) produced — the commit that
 * introduced this spec compared the two implementations live on every
 * stock frame (17007 frames, 0 mismatches) before hull.js was dropped —
 * and was then changed ONCE, deliberately, by ruling #207: frames with
 * fewer than four opaque pixels became real hulls (see makeConvexHull),
 * the digest below was rebaselined, and PROTOCOL_VERSION went to 6.
 */

/** A mask over an explicit list of filled pixels. */
function maskOf(width: number, height: number,
    filled: Array<[number, number]>): Mask {
    const set = new Set(filled.map(([x, y]) => y * width + x));
    return {
        width, height,
        isFilled: (x, y) => x >= 0 && x < width && y >= 0 && y < height
            && set.has(y * width + x),
    };
}

describe("makeConvexHull (the fallback hull)", () => {
    // Pixel (x, y) of a 4x4 mask maps to hull point (x - 2, 2 - y). The
    // y flip makes the centre row -0, which is 0 once serialized (the only
    // way a hull leaves the parser), so the comparisons go through JSON.
    function expectHull(mask: Mask, expected: Array<[number, number]>): void {
        expect(JSON.stringify(makeConvexHull(mask)))
            .toEqual(JSON.stringify(expected));
    }

    it("is the default box for an empty mask", () => {
        expect(makeConvexHull(maskOf(4, 4, []))).toEqual(getDefaultConvexHull());
    });

    /**
     * Ruling #207: fewer than four pixels still make a REAL hull — a
     * point, a segment, or a counterclockwise triangle — starting, like
     * every other hull, from the (x, y)-greatest pixel. (They used to be
     * handed back sorted, which for three pixels could wind clockwise.)
     */
    it("makes a one-point hull of a lone pixel", () => {
        expectHull(maskOf(4, 4, [[1, 1]]), [[-1, 1]]);
    });

    it("makes a segment of two pixels, from the (x, y)-greatest", () => {
        expectHull(maskOf(4, 4, [[3, 0], [0, 3]]), [[1, 2], [-2, -1]]);
    });

    it("makes a counterclockwise triangle of three pixels", () => {
        // Pixels (0,2) (1,1) (2,2) -> points (-2,0) (-1,1) (0,0): from
        // the greatest, (0,0), counterclockwise means up to (-1,1) and
        // back down to (-2,0). Sorted order would have wound clockwise.
        expectHull(maskOf(4, 4, [[0, 2], [1, 1], [2, 2]]),
            [[0, 0], [-1, 1], [-2, 0]]);
    });

    it("collapses three collinear pixels to the segment's ends", () => {
        expectHull(maskOf(4, 4, [[0, 1], [1, 1], [2, 1]]), [[0, 1], [-2, 1]]);
    });

    it("starts a hull at its (x, y)-greatest pixel and runs counterclockwise",
        () => {
            const square = maskOf(4, 4, [[1, 1], [2, 1], [1, 2], [2, 2]]);
            expectHull(square, [[0, 1], [-1, 1], [-1, 0], [0, 0]]);
            // A row of pixels collapses to its two ends.
            const row = maskOf(4, 4, [[0, 1], [1, 1], [2, 1], [3, 1]]);
            expectHull(row, [[1, 1], [-2, 1]]);
        });
});

/**
 * Over the real stock data (base "Nova Files" only, so the set of ids does
 * not depend on which plug-ins are installed). Skipped when
 * packages/nova/Nova_Data is not linked (see scripts/setup_worktree.sh).
 */
describe("sprite sheet pipeline over every stock rlëD", () => {
    const novaData = path.join(fixturesDir, "..", "..", "..", "nova", "Nova_Data");
    const hasData = fs.existsSync(path.join(novaData, "Nova Files"));
    // Parsing every sheet and hull takes tens of seconds, not jasmine's
    // default five.
    const TIMEOUT_MS = 300_000;

    // The stock data as shipped: 282 rlëDs, and the SHA-256 over their
    // hulls, frame tables and sheet pixels (see digestOf). First pinned at
    // ac8cda14 to what the hull.js implementation produced
    // (c37a19320090cb97c584c5e365dcf47df1059a4b52cd5dce35e0c24f67088e26);
    // rebaselined ONCE by ruling #207, when frames with fewer than four
    // opaque pixels became real hulls — only those frames' hulls differ.
    // Any change here is a change to hashed simulation input and must be
    // deliberate, with a PROTOCOL_VERSION bump beside it.
    const STOCK_RLED_COUNT = 282;
    const STOCK_DIGEST =
        "06cf529bc58ba157db73f1e6e8f7bfadc85567d5623f1245e67bffe69d92f6af";

    let np: NovaParse;
    let ids: string[];

    beforeAll(async () => {
        if (!hasData) {
            return;
        }
        np = new NovaParse(novaData, false,
            { novaFiles: "Nova Files", novaPlugins: null });
        np.resourceNotFoundFunction = () => { };
        np.flagNamespaceWarn = () => { };
        np.controlBitNamespaceWarn = () => { };
        const space = await np.idSpace;
        if (space instanceof Error) {
            throw space;
        }
        ids = Object.keys(space.rlëD).sort();
    });

    /**
     * One digest over, for every rlëD in id order: the id, its hulls and
     * frame table as JSON, and the packed sheet's dimensions and decoded
     * RGBA bytes. The decoded pixels rather than the PNG file, so the pin
     * does not depend on the zlib build.
     */
    async function digestOf(rledIds: string[]): Promise<string> {
        const overall = crypto.createHash("sha256");
        for (const id of rledIds) {
            const sheet = await np.data.SpriteSheet.get(id);
            const table = await np.data.SpriteSheetFrames.get(id);
            const image = await np.data.SpriteSheetImage.get(id);
            const decoded = PNG.sync.read(Buffer.from(image));
            const perId = crypto.createHash("sha256");
            perId.update(JSON.stringify(sheet.hulls));
            perId.update(JSON.stringify(table));
            perId.update(`${decoded.width}x${decoded.height}`);
            perId.update(decoded.data);
            overall.update(id).update(perId.digest("hex"));
        }
        return overall.digest("hex");
    }

    it("produces byte-identical sheets, frame tables and hulls", async () => {
        if (!hasData) {
            pending("packages/nova/Nova_Data is not linked");
            return;
        }
        expect(ids.length).toBe(STOCK_RLED_COUNT);
        expect(await digestOf(ids)).toBe(STOCK_DIGEST);
    }, TIMEOUT_MS);
});
