global.Promise = require("bluebird"); // For stacktraces

import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import "mocha";
import { readResourceFork, ResourceMap } from "resourceforkjs";
import { SpobResource } from "../../src/resource_parsers/SpobResource";
import { defaultIDSpace } from "./DefaultIDSpace";



before(function() {
    chai.should();
    chai.use(chaiAsPromised);
});

const expect = chai.expect;

describe("SpobResource", function() {


    // Spobs don't depend on other resources.
    var idSpace = defaultIDSpace;

    var rf: ResourceMap;
    var p1: SpobResource;
    var p2: SpobResource;

    before(async function() {
        rf = await readResourceFork("novaparse/test/resource_parsers/files/spob.ndat", false);
        var spobs = rf.spöb;
        p1 = new SpobResource(spobs[128], idSpace);
        p2 = new SpobResource(spobs[129], idSpace);
    });
    it("should parse position", function() {
        expect(p1.position).to.deep.equal([123, 456]);
        expect(p2.position).to.deep.equal([-321, -42]);
    });

    it("should parse graphic", function() {
        expect(p1.graphic).to.equal(2042);
        expect(p2.graphic).to.equal(2060);
    });

    it("should parse government", function() {
        expect(p1.government).to.equal(190);
        expect(p2.government).to.equal(163);

    });

    it("should parse techLevel", function() {
        expect(p1.techLevel).to.equal(72);
        expect(p2.techLevel).to.equal(15000);
    });

    it("should parse landingPictID", function() {
        expect(p1.landingPictID).to.equal(10003);
        expect(p2.landingPictID).to.equal(10042);

    });

    it("should set landingDescID", function() {
        expect(p1.landingDescID).to.equal(128);
        expect(p2.landingDescID).to.equal(129);
    });


});

