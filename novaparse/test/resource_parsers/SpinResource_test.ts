import "jasmine";
import { readResourceFork, ResourceMap } from "resourceforkjs";
import { SpinResource } from "../../src/resource_parsers/SpinResource";
import { defaultIDSpace } from "./DefaultIDSpace";
import { NovaResourceType } from "../../src/resource_parsers/ResourceHolderBase";


describe("SpinResource", function() {
    // Spins don't depend on other resources.
    const idSpace = defaultIDSpace;

    let rf: ResourceMap;
    let explosion: SpinResource;
    let blaster: SpinResource;

    beforeEach(async function() {
        const dataPath = require.resolve("novajs/novaparse/test/resource_parsers/files/spin.ndat");
        rf = await readResourceFork(dataPath, false);
        var spins = rf.spïn;
        explosion = new SpinResource(spins[412], idSpace);
        blaster = new SpinResource(spins[3000], idSpace);
    });

    it("should parse imageType", function() {
        expect(explosion.imageType).toEqual(NovaResourceType.rlëD);
        expect(blaster.imageType).toEqual(NovaResourceType.rlëD);
    });

    it("should parse spriteID", function() {
        expect(explosion.spriteID).toEqual(4024);
        expect(blaster.spriteID).toEqual(200);
    });

    it("should parse spriteSize", function() {
        expect(explosion.spriteSize).toEqual([145, 145]);
        expect(blaster.spriteSize).toEqual([35, 35]);
    });

    it("should parse spriteTiles", function() {
        expect(explosion.spriteTiles).toEqual([17, 1]);
        expect(blaster.spriteTiles).toEqual([6, 6]);
    });
});
