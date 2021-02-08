import "jasmine";
import { readResourceFork, ResourceMap } from "resourceforkjs";
import { OutfResource } from "../../src/resource_parsers/OutfResource";
import { NovaResources } from "../../src/resource_parsers/ResourceHolderBase";
import { defaultIDSpace } from "./DefaultIDSpace";

// Bazel no longer patches require.
const runfiles = require(process.env['BAZEL_NODE_RUNFILES_HELPER'] as string) as typeof require;

describe("OutfResource", function() {
    let rf: ResourceMap;

    // Outfits don't depend on othe resources.
    const idSpace: NovaResources = defaultIDSpace;

    let w1: OutfResource;
    let blank: OutfResource;
    let armor: OutfResource;
    let shields: OutfResource;
    let armorRecharge: OutfResource;
    let shieldRecharge: OutfResource;
    let speedIncrease: OutfResource;
    let accelBoost: OutfResource;
    let turnRate: OutfResource;
    let afterburner: OutfResource;
    let four: OutfResource;
    let anotherFour: OutfResource;

    beforeEach(async function() {
        const dataPath = runfiles.resolve("novajs/novaparse/test/resource_parsers/files/outf.ndat");
        rf = await readResourceFork(dataPath, false);

        var outfs = rf.oütf;
        w1 = new OutfResource(outfs[128], idSpace);
        blank = new OutfResource(outfs[129], idSpace);
        armor = new OutfResource(outfs[130], idSpace);
        shields = new OutfResource(outfs[131], idSpace);
        armorRecharge = new OutfResource(outfs[132], idSpace);
        shieldRecharge = new OutfResource(outfs[133], idSpace);
        speedIncrease = new OutfResource(outfs[134], idSpace);
        accelBoost = new OutfResource(outfs[135], idSpace);
        turnRate = new OutfResource(outfs[136], idSpace);
        afterburner = new OutfResource(outfs[137], idSpace);
        four = new OutfResource(outfs[138], idSpace);
        anotherFour = new OutfResource(outfs[139], idSpace);
    });

    it("should parse outfit functions", function() {
        expect(w1.functions).toEqual([
            ["weapon", 142]
        ]);

        expect(blank.functions).toEqual([]);

        expect(armor.functions).toEqual([
            ["armor", 42]
        ]);

        expect(shields.functions).toEqual([
            ["shield", 424]
        ]);

        expect(armorRecharge.functions).toEqual([
            ["armorRecharge", 123]
        ]);

        expect(shieldRecharge.functions).toEqual([
            ["shieldRecharge", 234]
        ]);

        expect(speedIncrease.functions).toEqual([
            ["speed", 19]
        ]);

        expect(accelBoost.functions).toEqual([
            ["acceleration", 81]
        ]);

        expect(turnRate.functions).toEqual([
            ["turnRate", 53]
        ]);

        expect(afterburner.functions).toEqual([
            ["afterburner", 144]
        ]);

        expect(four.functions).toEqual([
            ["weapon", 153],
            ["acceleration", 14],
            ["armor", 92],
            ["shield", 525]
        ]);

        expect(anotherFour.functions).toEqual([
            ["shieldRecharge", 99],
            ["jam 3", 23],
            ["IFF", true],
            ["energy", 1454]
        ]);
    });

    it("should parse maximum allowed", function() {
        expect(w1.max).toEqual(12);
        expect(blank.max).toEqual(999);
        expect(armor.max).toEqual(124);
        expect(shields.max).toEqual(337);
        expect(armorRecharge.max).toEqual(32767);
    });

    it("should calculate pictID", function() {
        expect(w1.pictID).toEqual(6000);
        expect(anotherFour.pictID).toEqual(6011);
    });

    it("should parse mass", function() {
        expect(w1.mass).toEqual(12);
        expect(armor.mass).toEqual(5);
        expect(shields.mass).toEqual(1221);
    });

    it("should parse cost", function() {
        expect(w1.cost).toEqual(1312);
        expect(blank.cost).toEqual(0);
        expect(armor.cost).toEqual(9404);
        expect(shields.cost).toEqual(12345);
        expect(armorRecharge.cost).toEqual(1234567);
        expect(shieldRecharge.cost).toEqual(-534);
    });

    it("should parse displayWeight", function() {
        expect(w1.displayWeight).toEqual(14);
        expect(blank.displayWeight).toEqual(0);
        expect(armor.displayWeight).toEqual(423);
    });
});
