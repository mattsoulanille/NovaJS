import "jasmine";
import { readResourceFork, ResourceMap } from "resourceforkjs";
import { RledResource } from "../../src/resource_parsers/RledResource";
import { PNG } from "pngjs";
import { getPNG, getFrames, applyMask, PNGCustomMatchers } from "./PNGCompare"
import { defaultIDSpace } from "./DefaultIDSpace";


declare global {
    namespace jasmine {
        interface Matchers<T> {
            toEqualPNG(expected: unknown): boolean
        }
    }
}

describe("RledResource", function() {

    let rf: ResourceMap;
    let starbridge: RledResource;
    let leviathan: RledResource;
    let starbridgePNG: PNG;
    let starbridgeMask: PNG;
    let leviathanPNG: PNG;
    let leviathanMask: PNG;

    // Rleds don't depend on other resources.
    const idSpace = defaultIDSpace;

    beforeEach(async function() {
        jasmine.addMatchers(PNGCustomMatchers);

        starbridgePNG = await getPNG("novaparse/test/resource_parsers/files/rleds/starbridge.png");
        starbridgeMask = await getPNG("novaparse/test/resource_parsers/files/rleds/starbridge_mask.png");
        leviathanPNG = await getPNG("novaparse/test/resource_parsers/files/rleds/leviathan.png");
        leviathanMask = await getPNG("novaparse/test/resource_parsers/files/rleds/leviathan_mask.png");

        const dataPath = require.resolve("novajs/novaparse/test/resource_parsers/files/rled.ndat");
        rf = await readResourceFork(dataPath, false);

        const rleds = rf.rlëD;
        starbridge = new RledResource(rleds[1010], idSpace);
        leviathan = new RledResource(rleds[1006], idSpace);
    });

    it("should produce an ordered array of frames", function() {
        const starbridgeApplied = applyMask(starbridgePNG, starbridgeMask);
        const leviathanApplied = applyMask(leviathanPNG, leviathanMask);

        const starbridgeFrames = getFrames(starbridgeApplied, { width: 48, height: 48 });
        const leviathanFrames = getFrames(leviathanApplied, { width: 144, height: 144 });

        const parsedStarbridgeFrames = starbridge.frames;
        const parsedLeviathanFrames = leviathan.frames

        expect(parsedStarbridgeFrames.length).toEqual(starbridgeFrames.length);
        expect(parsedLeviathanFrames.length).toEqual(leviathanFrames.length);

        for (let i = 0; i < parsedStarbridgeFrames.length; i++) {
            expect(starbridgeFrames[i]).toEqualPNG(parsedStarbridgeFrames[i]);
        }

        for (let i = 0; i < parsedLeviathanFrames.length; i++) {
            expect(leviathanFrames[i]).toEqualPNG(parsedLeviathanFrames[i]);
        }
    });
});
