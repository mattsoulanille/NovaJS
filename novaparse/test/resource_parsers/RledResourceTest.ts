global.Promise = require("bluebird"); // For stacktraces

import * as chai from "chai";
import "mocha";
import * as chaiAsPromised from "chai-as-promised";
import * as fs from "fs";

import { readResourceFork, ResourceMap } from "resourceforkjs";

import { RledResource } from "../../src/resource_parsers/RledResource";
import { NovaResources } from "../../src/resource_parsers/ResourceHolderBase";
import { PNG } from "pngjs";
import { assert } from "chai";
import { getPNG, comparePNGs, getFrames, applyMask } from "./PNGCompare"
import { defaultIDSpace } from "./DefaultIDSpace";


before(function() {
    chai.should();
    chai.use(chaiAsPromised);
});

const expect = chai.expect;


describe("RledResource", function() {

    var rf: ResourceMap;
    var starbridge: RledResource;
    var leviathan: RledResource;
    var starbridgePNG: PNG;
    var starbridgeMask: PNG;
    var leviathanPNG: PNG;
    var leviathanMask: PNG;

    // Rleds don't depend on other resources.
    var idSpace = defaultIDSpace;

    before(async function() {
        this.timeout(10000); // 10 seconds to read all files
        starbridgePNG = await getPNG("novaparse/test/resource_parsers/files/rleds/starbridge.png");
        starbridgeMask = await getPNG("novaparse/test/resource_parsers/files/rleds/starbridge_mask.png");
        leviathanPNG = await getPNG("novaparse/test/resource_parsers/files/rleds/leviathan.png");
        leviathanMask = await getPNG("novaparse/test/resource_parsers/files/rleds/leviathan_mask.png");

        rf = await readResourceFork("novaparse/test/resource_parsers/files/rled.ndat", false);

        var rleds = rf.rlëD;
        starbridge = new RledResource(rleds[1010], idSpace);
        leviathan = new RledResource(rleds[1006], idSpace);
    });

    it("comparePNGs should work for the same picture", function() {
        comparePNGs(starbridgePNG, starbridgePNG);
    });

    it("comparePNG should work for different pictures", function() {
        expect(function() {
            comparePNGs(starbridgePNG, starbridgeMask);
        }).to.throw();

    });

    it("getFrames should work", async function() {

        var starbridgeFrames = getFrames(starbridgePNG, { width: 48, height: 48 });

        var pngs: Array<PNG> = [];
        var promises: Array<Promise<void>> = [];
        for (var i = 0; i < 108; i++) {
            var path = "novaparse/test/resource_parsers/files/rleds/testFrames/" + "starbridge" + i + ".png";
            promises.push(async function(): Promise<void> {
                var index = i;
                pngs[index] = await getPNG(path);
            }());
        }

        await Promise.all(promises);

        for (var i = 0; i < 108; i++) {
            comparePNGs(pngs[i], starbridgeFrames[i]);
        }

    });

    it("should produce an ordered array of frames", async function() {
        this.timeout(10000);
        var starbridgeApplied = applyMask(starbridgePNG, starbridgeMask);
        var leviathanApplied = applyMask(leviathanPNG, leviathanMask);

        var starbridgeFrames = getFrames(starbridgeApplied, { width: 48, height: 48 });
        var leviathanFrames = getFrames(leviathanApplied, { width: 144, height: 144 });

        var parsedStarbridgeFrames = starbridge.frames;
        var parsedLeviathanFrames = leviathan.frames

        assert.equal(parsedStarbridgeFrames.length, starbridgeFrames.length);
        assert.equal(parsedLeviathanFrames.length, leviathanFrames.length);



        for (var i = 0; i < parsedStarbridgeFrames.length; i++) {
            comparePNGs(starbridgeFrames[i], parsedStarbridgeFrames[i]);
        }

        for (var i = 0; i < parsedLeviathanFrames.length; i++) {
            comparePNGs(leviathanFrames[i], parsedLeviathanFrames[i]);
        }
    });
});
