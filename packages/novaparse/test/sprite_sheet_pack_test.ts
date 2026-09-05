import "jasmine";
import * as fs from "fs";
import * as path from "path";
import { PNG } from "pngjs";
import { fixturesDir } from "./fixtures.js";
import { NovaParse } from "../src/nova_parse.js";
import {
    buildPNG, buildSpriteSheetFrames, DimensionError, getWH,
} from "../src/parsers/sprite_sheet_multi_parse.js";
import { NovaResources } from "../src/resource_parsers/resource_holder_base.js";

/**
 * The sprite-sheet packer must lay frames out at their real HEIGHT. It
 * used to take the frame height from the frame WIDTH, which no square
 * ship sprite could reveal but which put every non-square rlëD — all the
 * stock stations, the hypergates, the ground explosion — in a
 * width x width rect: drawn (w-h)/2 px above the entity when wide, cropped
 * to `width` rows when tall.
 */

/** A w x h frame whose every pixel is opaque `value`. */
function solidFrame(width: number, height: number, value: number): PNG {
    const png = new PNG({ width, height });
    for (let i = 0; i < width * height; i++) {
        png.data[i * 4] = value;
        png.data[i * 4 + 1] = value;
        png.data[i * 4 + 2] = value;
        png.data[i * 4 + 3] = 255;
    }
    return png;
}

function opaquePixels(png: PNG): number {
    let count = 0;
    for (let i = 3; i < png.data.length; i += 4) {
        if (png.data[i] === 255) {
            count++;
        }
    }
    return count;
}

function pixelAt(png: PNG, x: number, y: number): [number, number] {
    const i = (png.width * y + x) * 4;
    return [png.data[i], png.data[i + 3]];
}

describe("sprite sheet packer (non-square frames)", () => {
    it("sizes a wide frame's sheet by its height, not its width", () => {
        const frames = [solidFrame(4, 2, 7)];
        expect(getWH(frames)).toEqual({
            singleFrameWidth: 4, singleFrameHeight: 2,
            fullPixelWidth: 4, fullPixelHeight: 2,
        });
        const sheet = buildPNG(frames);
        expect([sheet.width, sheet.height]).toEqual([4, 2]);
        expect(opaquePixels(sheet)).toEqual(8);
    });

    it("keeps every row of a tall frame", () => {
        // Rows 2 and 3 used to be written past a 2x2 row block and dropped.
        const frames = [solidFrame(2, 4, 9)];
        const sheet = buildPNG(frames);
        expect([sheet.width, sheet.height]).toEqual([2, 4]);
        expect(opaquePixels(sheet)).toEqual(8);
        expect(pixelAt(sheet, 1, 3)).toEqual([9, 255]);
    });

    it("stacks rows of tall frames at the frame height without overlap", () => {
        // 11 frames -> two rows (SHEET_LOOP is 10). With the old width-as-
        // height pitch the second row started 2 px down and overwrote the
        // bottom half of the first.
        const frames: PNG[] = [];
        for (let f = 0; f < 11; f++) {
            frames.push(solidFrame(2, 4, f + 1));
        }
        const sheet = buildPNG(frames);
        expect([sheet.width, sheet.height]).toEqual([20, 8]);
        expect(opaquePixels(sheet)).toEqual(11 * 8);
        // Frame 0's bottom row is still frame 0's colour...
        expect(pixelAt(sheet, 0, 3)).toEqual([1, 255]);
        // ...and frame 10 sits at the top-left of the second row.
        expect(pixelAt(sheet, 0, 4)).toEqual([11, 255]);
        expect(pixelAt(sheet, 1, 7)).toEqual([11, 255]);
        // Nothing to the right of frame 10 on the second row.
        expect(pixelAt(sheet, 2, 4)).toEqual([0, 0]);
    });

    it("publishes each frame rect at the frame's real height", () => {
        const frames: PNG[] = [];
        for (let f = 0; f < 11; f++) {
            frames.push(solidFrame(4, 2, 1));
        }
        const table = buildSpriteSheetFrames({ globalID: "test:1" }, frames);
        expect(table.meta.size).toEqual({ w: 40, h: 4 });
        expect(table.frames["test:1 0.png"].frame)
            .toEqual({ x: 0, y: 0, w: 4, h: 2 });
        expect(table.frames["test:1 10.png"].frame)
            .toEqual({ x: 0, y: 2, w: 4, h: 2 });
        expect(table.frames["test:1 10.png"].sourceSize)
            .toEqual({ w: 40, h: 4 });
    });

    it("refuses a frame whose size differs from frame 0", () => {
        expect(() => buildPNG([solidFrame(2, 2, 1), solidFrame(2, 3, 1)]))
            .toThrowError(DimensionError);
    });
});

/**
 * Pinned against the real stock data (base "Nova Files" only, so the
 * ids and sizes do not depend on which plug-ins are installed): a station
 * and a hypergate, the two stellar shapes players fly up to and land on.
 * Skipped when packages/nova/Nova_Data is not linked (see
 * scripts/setup_worktree.sh).
 */
describe("sprite sheet packer on real non-square rlëDs", () => {
    // fixturesDir is <novaparse>/test/fixtures whether the spec runs from
    // src or from dist, so the nova package is three levels up from it.
    const novaData = path.join(fixturesDir, "..", "..", "..", "nova", "Nova_Data");
    const hasData = fs.existsSync(path.join(novaData, "Nova Files"));
    let np: NovaParse;
    let idSpace: NovaResources;

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
        idSpace = space;
    });

    for (const [name, id, width, height] of [
        // CC Station (spïn 1000+ Type, used by Port Kane among others).
        ["CC Station", "nova:2034", 140, 85],
        // Broken Hypergate (HG-Aldebaran, HG-Vega, HG-Kon, HG-Murasaki).
        ["Broken Hypergate", "nova:2063", 53, 60],
        // Triple Auroran Station: taller than wide, so it was cropped.
        ["Triple Auroran Station", "nova:2059", 108, 140],
    ] as const) {
        it(`packs ${name} (${id}, ${width}x${height}) at its real size with `
            + `every opaque pixel`, async () => {
                if (!hasData) {
                    pending("packages/nova/Nova_Data is not linked");
                    return;
                }
                const rled = idSpace.rlëD[id];
                expect(rled.size).toEqual([width, height]);
                const sourceFrames = rled.frames;
                const sourceOpaque = sourceFrames
                    .map(opaquePixels).reduce((a, b) => a + b, 0);
                expect(sourceOpaque).toBeGreaterThan(0);

                const table = await np.data.SpriteSheetFrames.get(id);
                const rows = Math.ceil(sourceFrames.length / 10);
                const cols = Math.min(10, sourceFrames.length);
                expect(table.meta.size)
                    .toEqual({ w: cols * width, h: rows * height });
                for (let f = 0; f < sourceFrames.length; f++) {
                    const frame = table.frames[`${id} ${f}.png`].frame;
                    expect(frame).toEqual({
                        x: (f % 10) * width, y: Math.floor(f / 10) * height,
                        w: width, h: height,
                    });
                }

                const image = await np.data.SpriteSheetImage.get(id);
                const sheet = PNG.sync.read(Buffer.from(image));
                expect([sheet.width, sheet.height])
                    .toEqual([cols * width, rows * height]);
                expect(opaquePixels(sheet)).toEqual(sourceOpaque);
            });
    }
});
