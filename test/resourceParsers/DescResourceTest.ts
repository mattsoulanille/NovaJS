global.Promise = require("bluebird"); // For stacktraces

import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import "mocha";
import { readResourceFork, ResourceMap } from "resourceforkjs";
import { DescResource } from "../../src/resourceParsers/DescResource";
import { defaultIDSpace } from "./DefaultIDSpace";



before(function() {
    chai.should();
    chai.use(chaiAsPromised);
});

const expect = chai.expect;


describe("DescResource", function() {
    var d1: DescResource;
    var d2: DescResource;
    var rf: ResourceMap;

    // Descs don't depend on other resources.
    var idSpace = defaultIDSpace;

    before(async function() {

        rf = await readResourceFork("./test/resourceParsers/files/desc.ndat", false);

        var descs = rf.dësc;
        d1 = new DescResource(descs[128], idSpace);
        d2 = new DescResource(descs[129], idSpace);

    });

    it("Should parse the string in the desc", function() {
        expect(d1.text).to.equal("The first description has one line of text that you can read.");
        expect(d2.text).to.equal("This one has a graphic.");
    });
    // it("Should parse graphic", function() {
    //     expect(d2.graphic).to.equal(4214);
    // });



});
