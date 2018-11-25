global.Promise = require("bluebird"); // For stacktraces

import * as chai from "chai";
import "mocha";
import * as chaiAsPromised from "chai-as-promised";
import * as fs from "fs";

import { readResourceFork, ResourceMap } from "resourceforkjs";

import { RledResource } from "../../src/resourceParsers/RledResource";
import { NovaResources } from "../../src/ResourceHolderBase";
import { PNG } from "pngjs";
import { assert } from "chai";


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

    // Rleds don't depend on othe resources.
    var idSpace: NovaResources = {
        resources: {},
        prefix: "rleds"
    };

    before(async function() {
        this.timeout(10000); // 10 seconds to read all files
        starbridgePNG = await getPNG("./test/resourceParsers/files/rleds/starbridge.png");
        starbridgeMask = await getPNG("./test/resourceParsers/files/rleds/starbridge_mask.png");
        leviathanPNG = await getPNG("./test/resourceParsers/files/rleds/leviathan.png");
        leviathanMask = await getPNG("./test/resourceParsers/files/rleds/leviathan_mask.png");

        rf = await readResourceFork("./test/resourceParsers/files/rled.ndat", false);

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
            var path = "./test/resourceParsers/files/rleds/testFrames/" + "starbridge" + i + ".png";
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


function getPNG(path: string): Promise<PNG> {
    return new Promise(function(fulfill, reject) {
        var pngObj = new PNG({ filterType: 4 });
        fs.createReadStream(path)
            .pipe(pngObj)
            .on('parsed', function() {
                fulfill(pngObj);
            });
    });
};

function getFrames(png: PNG, dim: { width: number, height: number }) {

    // dim is dim of each frame;
    assert.equal(png.height % dim.height, 0);
    assert.equal(png.width % dim.width, 0);

    var out = [];

    for (var y = 0; y < png.height; y += dim.height) {
        for (var x = 0; x < png.width; x += dim.width) {
            var outPNG = new PNG({ filterType: 4, width: dim.width, height: dim.height });

            for (var xi = 0; xi < dim.width; xi++) {
                for (var yi = 0; yi < dim.height; yi++) {
                    var outidx = (outPNG.width * yi + xi) << 2;
                    var sourceidx = (png.width * (y + yi) + x + xi) << 2;
                    outPNG.data[outidx] = png.data[sourceidx];
                    outPNG.data[outidx + 1] = png.data[sourceidx + 1];
                    outPNG.data[outidx + 2] = png.data[sourceidx + 2];
                    outPNG.data[outidx + 3] = png.data[sourceidx + 3];
                }
            }

            out.push(outPNG);
        }
    }
    return out;

};

function comparePNGs(png1: PNG, png2: PNG) {
    assert(png1 instanceof PNG);
    assert(png2 instanceof PNG);
    assert.equal(png1.width, png2.width);
    assert.equal(png1.height, png2.height);
    assert.equal(png1.gamma, png2.gamma);
    //	assert(png1.data.equals(png2.data));

    // fuzzy compare
    for (var y = 0; y < png1.height; y++) {
        for (var x = 0; x < png1.width; x++) {
            var idx = (png1.width * y + x) << 2;

            if ((png1.data[idx + 3] !== 0) || (png2.data[idx + 3]) !== 0) {
                assert.equal(png1.data[idx] >> 3, png2.data[idx] >> 3);
                assert.equal(png1.data[idx + 1] >> 3, png2.data[idx + 1] >> 3);
                assert.equal(png1.data[idx + 2] >> 3, png2.data[idx + 2] >> 3);
                assert.equal(png1.data[idx + 3], png2.data[idx + 3]);

            }

        }
    }
};

function applyMask(image: PNG, mask: PNG) {
    assert.equal(image.width, mask.width);
    assert.equal(image.height, mask.height);

    var out = new PNG({
        filterType: 4,
        width: image.width,
        height: image.height
    });
    image.data.copy(out.data, 0, 0, image.data.length); // copy image to out

    for (var y = 0; y < image.height; y++) {
        for (var x = 0; x < image.width; x++) {
            var idx = (image.width * y + x) << 2;

            if ((mask.data[idx] === 0) &&
                (mask.data[idx + 1] === 0) &&
                (mask.data[idx + 2] === 0)) {

                // change out's alpha to clear wherever mask is black
                out.data[idx + 3] = 0;
            }
            else {
                // alpha is opaque everywhere else
                out.data[idx + 3] = 255;
            }
        }
    }

    return out;
};
