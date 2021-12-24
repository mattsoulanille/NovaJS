import "jasmine";
import { readResourceFork, ResourceMap } from "resourceforkjs";
import { SystResource } from "nova_parse/src/resource_parsers/SystResource";
import { defaultIDSpace } from "./DefaultIDSpace";

// Bazel no longer patches require.
const runfiles = require(process.env['BAZEL_NODE_RUNFILES_HELPER'] as string) as typeof require;

describe("SystResource", function() {
    // Systs don't depend on other resources.
    const idSpace = defaultIDSpace;

    let rf: ResourceMap;
    let s1: SystResource;
    let s2: SystResource;

    beforeEach(async function() {
        const dataPath = runfiles.resolve("novajs/nova_parse/test/resource_parsers/files/syst.ndat");
        rf = await readResourceFork(dataPath, false);
        const systs = rf.sÿst;
        s1 = new SystResource(systs[128], idSpace);
        s2 = new SystResource(systs[129], idSpace);
    });

    it("should parse position", function() {
        expect(s1.position).toEqual([42, 84]);
        expect(s2.position).toEqual([-28, -96]);
    });

    it("should parse links", function() {
        expect(s1.links).toEqual(new Set([129, 163]));
        expect(s2.links).toEqual(new Set([128, 163]));
    });

    it("should parse spobs", function() {
        expect(s1.spobs).toEqual([128, 189, 194]);
    });
});
