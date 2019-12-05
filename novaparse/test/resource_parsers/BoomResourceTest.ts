global.Promise = require("bluebird"); // For stacktraces

import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import "mocha";
import { readResourceFork, ResourceMap } from "resourceforkjs";
import { BoomResource } from "../../src/resource_parsers/BoomResource";
import { defaultIDSpace } from "./DefaultIDSpace";


before(function() {
    chai.should();
    chai.use(chaiAsPromised);
});

const expect = chai.expect;

describe("BoomResource", function() {


    // Booms don't depend on other resources.
    var idSpace = defaultIDSpace;

    var rf: ResourceMap;
    var firstBoom: BoomResource;
    var silentBoom: BoomResource;
    var slowBoom: BoomResource;

    before(async function() {
        rf = await readResourceFork("novaparse/test/resource_parsers/files/boom.ndat", false);
        var booms = rf.bööm;
        firstBoom = new BoomResource(booms[128], idSpace);
        silentBoom = new BoomResource(booms[129], idSpace);
        slowBoom = new BoomResource(booms[130], idSpace);
    });

    it("should parse all inherited properties", function() {
        expect(firstBoom.id).to.equal(128);


    });


    it("should parse animation rate", function() {
        expect(firstBoom.animationRate).to.equal(100);
        expect(silentBoom.animationRate).to.equal(79);
        expect(slowBoom.animationRate).to.equal(23);
    });

    it("should parse sound", function() {
        expect(firstBoom.sound).to.equal(300);
        expect(silentBoom.sound).to.equal(null);
        expect(slowBoom.sound).to.equal(344);

    });

    it("should parse graphic", function() {
        expect(firstBoom.graphic).to.equal(400);
        expect(silentBoom.graphic).to.equal(423);
        expect(slowBoom.graphic).to.equal(412);
    });

});
