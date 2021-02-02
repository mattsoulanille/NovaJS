import "jasmine";
import { readResourceFork, ResourceMap } from "resourceforkjs";
import { DescResource } from "../../src/resource_parsers/DescResource";
import { defaultIDSpace } from "./DefaultIDSpace";


describe("DescResource", function() {
    let d1: DescResource;
    let d2: DescResource;
    let rf: ResourceMap;

    // Descs don't depend on other resources.
    const idSpace = defaultIDSpace;

    beforeEach(async function() {
        const dataPath = require.resolve("novajs/novaparse/test/resource_parsers/files/desc.ndat");
        rf = await readResourceFork(dataPath, false);

        const descs = rf.dësc;
        d1 = new DescResource(descs[128], idSpace);
        d2 = new DescResource(descs[129], idSpace);

    });

    it("Should parse the string in the desc", function() {
        expect(d1.text).toEqual("The first description has one line of text that you can read.");
        expect(d2.text).toEqual("This one has a graphic.");
    });
    // it("Should parse graphic", function() {
    //     expect(d2.graphic).to.equal(4214);
    // });
});
