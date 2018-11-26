global.Promise = require("bluebird"); // For stacktraces

import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import "mocha";
import { readResourceFork, ResourceMap } from "resourceforkjs";
import { SpinResource } from "../../src/resourceParsers/SpinResource";
import { defaultIDSpace } from "./DefaultIDSpace";
import { assert } from "chai";
import { NovaResourceType } from "../../src/ResourceHolderBase";



before(function() {
    chai.should();
    chai.use(chaiAsPromised);
});

const expect = chai.expect;


describe("SpinResource", function() {


    // Spins don't depend on other resources.
    var idSpace = defaultIDSpace;

    var rf: ResourceMap;
    var explosion: SpinResource;
    var blaster: SpinResource;

    before(async function() {
        rf = await readResourceFork("./test/resourceParsers/files/spin.ndat", false);
        var spins = rf.spïn;
        explosion = new SpinResource(spins[412], idSpace);
        blaster = new SpinResource(spins[3000], idSpace);
    });

    it("should parse imageType", function() {
        assert.equal(explosion.imageType, NovaResourceType.rlëD);
        assert.equal(blaster.imageType, NovaResourceType.rlëD);
    });

    it("should parse spriteID", function() {
        assert.equal(explosion.spriteID, 4024);
        assert.equal(blaster.spriteID, 200);
    });

    it("should parse spriteSize", function() {
        assert.equal(explosion.spriteSize[0], 145);
        assert.equal(explosion.spriteSize[1], 145);
        assert.equal(blaster.spriteSize[0], 35);
        assert.equal(blaster.spriteSize[1], 35);
    });

    it("should parse spriteTiles", function() {
        assert.equal(explosion.spriteTiles[0], 17);
        assert.equal(explosion.spriteTiles[1], 1);
        assert.equal(blaster.spriteTiles[0], 6);
        assert.equal(blaster.spriteTiles[1], 6);
    });


});
