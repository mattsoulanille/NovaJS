global.Promise = require("bluebird"); // For stacktraces

import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import "mocha";
import { readResourceFork, ResourceMap } from "resourceforkjs";
import { SystResource } from "../../src/resourceParsers/SystResource";
import { defaultIDSpace } from "./DefaultIDSpace";



before(function() {
    chai.should();
    chai.use(chaiAsPromised);
});

const expect = chai.expect;

describe("SystResource", function() {


    // Systs don't depend on other resources.
    var idSpace = defaultIDSpace;

    var rf: ResourceMap;
    var s1: SystResource;
    var s2: SystResource;

    before(async function() {
        rf = await readResourceFork("./test/resourceParsers/files/syst.ndat", false);
        var systs = rf.sÿst;
        s1 = new SystResource(systs[128], idSpace);
        s2 = new SystResource(systs[129], idSpace);
    });

    it("should parse position", function() {
        expect(s1.position).to.deep.equal([42, 84]);
        expect(s2.position).to.deep.equal([-28, -96]);
    });

    it("should parse links", function() {
        expect(s1.links).to.deep.equal(new Set([129, 163]));
        expect(s2.links).to.deep.equal(new Set([128, 163]));
    });

    it("should parse spobs", function() {
        expect(s1.spobs).to.deep.equal([128, 189, 194]);
    });

});
