import "jasmine";
import { PNG } from "pngjs";
import { readResourceFork, ResourceMap } from "resourceforkjs";
import { NovaResources } from "../../src/resource_parsers/ResourceHolderBase";
import { PictResource } from "../../src/resource_parsers/PictResource";
import { getPNG, PNGCustomMatchers } from "./PNGCompare";
import { defaultIDSpace } from "./DefaultIDSpace";


declare global {
    namespace jasmine {
        interface Matchers<T> {
            toEqualPNG(expected: unknown): boolean
        }
    }
}

// Bazel no longer patches require.
const runfiles = require(process.env['BAZEL_NODE_RUNFILES_HELPER'] as string) as typeof require;

describe("PictResource", function() {
    let ship: PictResource;
    let landed: PictResource;
    let statusBar: PictResource;
    let targetImage: PictResource;

    let shipPNG: PNG;
    let landedPNG: PNG;
    let statusBarPNG: PNG;
    let targetImagePNG: PNG;
    let rf: ResourceMap;

    // Picts don't depend on other resources.
    const idSpace: NovaResources = defaultIDSpace;

    beforeEach(async function() {
        jasmine.addMatchers(PNGCustomMatchers);

        shipPNG = await getPNG(runfiles.resolve(
            "novajs/nova_parse/test/resource_parsers/files/picts/ship.png"));
        landedPNG = await getPNG(runfiles.resolve(
            "novajs/nova_parse/test/resource_parsers/files/picts/landed.png"));
        statusBarPNG = await getPNG(runfiles.resolve(
            "novajs/nova_parse/test/resource_parsers/files/picts/statusBar.png"));
        targetImagePNG = await getPNG(runfiles.resolve(
            "novajs/nova_parse/test/resource_parsers/files/picts/targetImage.png"));

        const dataPath = runfiles.resolve("novajs/nova_parse/test/resource_parsers/files/pict.ndat");
        rf = await readResourceFork(dataPath, false);

        const picts = rf.PICT;
        ship = new PictResource(picts[20158], idSpace);
        landed = new PictResource(picts[10034], idSpace);
        statusBar = new PictResource(picts[700], idSpace);
        targetImage = new PictResource(picts[3000], idSpace);
    });

    it("should parse pict into a png", function() {
        expect(ship.png).toEqualPNG(shipPNG);
        expect(landed.png).toEqualPNG(landedPNG);
        expect(statusBar.png).toEqualPNG(statusBarPNG);
        expect(targetImage.png).toEqualPNG(targetImagePNG);
    });
});
