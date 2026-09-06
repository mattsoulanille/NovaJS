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
 * fallback convex hull is held to the exact vertex order its previous
 * implementation (hull.js, concavity Infinity) produced. The commit that
 * introduced this spec compared the two implementations live on every
 * stock frame (17007 frames, 0 mismatches) before hull.js was dropped.
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

    it("returns one, two or three pixels as they are, in (x, y) order", () => {
        expectHull(maskOf(4, 4, [[1, 1]]), [[-1, 1]]);
        expectHull(maskOf(4, 4, [[3, 0], [0, 3]]), [[-2, -1], [1, 2]]);
        // Not a counterclockwise hull: hull.js returned so few points
        // sorted, and that order is what the pinned geometry holds.
        expectHull(maskOf(4, 4, [[0, 2], [1, 1], [2, 2]]),
            [[-2, 0], [-1, 1], [0, 0]]);
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
    // hulls, frame tables and sheet pixels (see digestOf) as produced at
    // ac8cda14 by the hull.js implementation. Any change here is a change
    // to hashed simulation input and must be deliberate.
    const STOCK_RLED_COUNT = 282;
    const STOCK_DIGEST =
        "c37a19320090cb97c584c5e365dcf47df1059a4b52cd5dce35e0c24f67088e26";

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
