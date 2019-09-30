global.Promise = require("bluebird"); // For stacktraces

import * as chai from "chai";
import { assert } from "chai";
import * as chaiAsPromised from "chai-as-promised";
import "mocha";
import { readResourceFork, ResourceMap } from "resourceforkjs";
import { ShanResource } from "../../src/resourceParsers/ShanResource";
import { defaultIDSpace } from "./DefaultIDSpace";



before(function() {
    chai.should();
    chai.use(chaiAsPromised);
});

const expect = chai.expect;

describe("ShanResource", function() {


    // Shans don't depend on other resources.
    var idSpace = defaultIDSpace;

    var rf: ResourceMap;
    var miner: ShanResource;
    var thunderforge: ShanResource;
    var shuttle: ShanResource;

    before(async function() {
        rf = await readResourceFork("./test/resourceParsers/files/shan.ndat", false);
        var shans = rf.shän;
        shuttle = new ShanResource(shans[128], idSpace);
        thunderforge = new ShanResource(shans[380], idSpace);
        miner = new ShanResource(shans[379], idSpace);
    });

    it("should parse baseImage ID", function() {
        assert.propertyVal(shuttle.images.baseImage, "ID", 1000);
        assert.propertyVal(thunderforge.images.baseImage, "ID", 1130);
        assert.propertyVal(miner.images.baseImage, "ID", 1128);
    });

    it("should parse baseImage maskID", function() {
        assert.propertyVal(shuttle.images.baseImage, "maskID", 1001);
        assert.propertyVal(thunderforge.images.baseImage, "maskID", 1131);
        assert.propertyVal(miner.images.baseImage, "maskID", 1129);
    });

    it("should parse baseImage setCount", function() {
        // number of sets of images (rotations / animations)
        assert.propertyVal(shuttle.images.baseImage, "setCount", 3);
        assert.propertyVal(thunderforge.images.baseImage, "setCount", 1);
        assert.propertyVal(miner.images.baseImage, "setCount", 6);
    });

    it("should parse baseImage size", function() {
        assert.deepPropertyVal(shuttle.images.baseImage, "size", [24, 24]);
        assert.deepPropertyVal(thunderforge.images.baseImage, "size", [130, 130]);
        assert.deepPropertyVal(miner.images.baseImage, "size", [80, 80]);
    });

    it("should parse baseImage.transparency", function() {
        assert.propertyVal(shuttle.images.baseImage, "transparency", 0);
        assert.propertyVal(thunderforge.images.baseImage, "transparency", 0);
        assert.propertyVal(miner.images.baseImage, "transparency", 0);
    });

    it("should parse altImage ID", function() {
        assert.isNull(shuttle.images.altImage);
        assert.propertyVal(thunderforge.images.altImage, "ID", 1330);
        assert.isNull(miner.images.altImage)
    });

    it("should parse altImage maskID", function() {
        assert.propertyVal(thunderforge.images.altImage, "maskID", 1331);
    });

    it("should parse altImage setCount", function() {
        assert.propertyVal(thunderforge.images.altImage, "setCount", 6);
    });

    it("should parse altImage size", function() {
        assert.deepPropertyVal(thunderforge.images.altImage, "size", [260, 260]);
    });

    it("should parse glowImage ID", function() {
        assert.propertyVal(shuttle.images.glowImage, "ID", 1400);
        assert.propertyVal(thunderforge.images.glowImage, "ID", 1530);
        assert.propertyVal(miner.images.glowImage, "ID", 1528);
    });

    it("should parse glowImage maskID", function() {
        assert.propertyVal(shuttle.images.glowImage, "maskID", 1401);
        assert.propertyVal(thunderforge.images.glowImage, "maskID", 1531);
        assert.propertyVal(miner.images.glowImage, "maskID", 1529);
    });
    /*
      it("should parse glowImage setCount", function() {
      // set this to .images.baseImage setCount (or 0 if no glow image)
      assert.propertyVal(shuttle.images.glowImage,"setCount", 3);
      assert.propertyVal(thunderforge.images.glowImage,"setCount", 1);
      assert.propertyVal(miner.images.glowImage,"setCount", 6);
      });
    */
    it("should parse glowImage size", function() {
        assert.deepPropertyVal(shuttle.images.glowImage, "size", [48, 48]);
        assert.deepPropertyVal(thunderforge.images.glowImage, "size", [260, 260]);
        assert.deepPropertyVal(miner.images.glowImage, "size", [80, 80]);
    });

    it("should parse lightImage ID", function() {
        assert.propertyVal(shuttle.images.lightImage, "ID", 1600);
        assert.isNull(thunderforge.images.lightImage);
        assert.propertyVal(miner.images.lightImage, "ID", 1728);
    });

    it("should parse lightImage maskID", function() {
        assert.propertyVal(shuttle.images.lightImage, "maskID", 1601);
        assert.propertyVal(miner.images.lightImage, "maskID", 1729);
    });
    /*
      it("should parse lightImage setCount", function() {
      // set this to baseImage setCount (or 0 if no light image)
      assert.propertyVal(shuttle.images.lightImage,"setCount", 3);
      assert.propertyVal(thunderforge.images.lightImage,"setCount", 0);
      assert.propertyVal(miner.images.lightImage,"setCount", 6);
      });
    */
    it("should parse lightImage size", function() {
        assert.deepPropertyVal(shuttle.images.lightImage, "size", [48, 48]);
        assert.deepPropertyVal(miner.images.lightImage, "size", [80, 80]);
    });

    it("should parse weapImage ID", function() {
        assert.isNull(shuttle.images.weapImage);
        assert.propertyVal(thunderforge.images.weapImage, "ID", 1930);
        assert.isNull(miner.images.weapImage);
    });

    it("should parse weapImage maskID", function() {
        assert.propertyVal(thunderforge.images.weapImage, "maskID", 1931);
    });
    /*
      it("should parse weapImage setCount", function() {
      // set this to baseImage setCount (or 0 if no weap image)
      assert.propertyVal(shuttle.images.weapImage,"setCount", 0);
      assert.propertyVal(thunderforge.images.weapImage,"setCount", 1);
      assert.propertyVal(miner.images.weapImage,"setCount", 0);
      });
    */
    it("should parse weapImage size", function() {
        assert.deepPropertyVal(thunderforge.images.weapImage, "size", [260, 260]);
    });


    it("should parse flags", function() {
        assert.equal(shuttle.flags.extraFramePurpose, "banking");
        assert.equal(shuttle.flags.stopAnimationWhenDisabled, false);
        assert.equal(shuttle.flags.hideAltSpritesWhenDisabled, false);
        assert.equal(shuttle.flags.hideLightsWhenDisabled, true);
        assert.equal(shuttle.flags.unfoldWhenFiring, false);
        assert.equal(shuttle.flags.adjustForOffset, false);

        assert.equal(thunderforge.flags.extraFramePurpose, "animation");
        assert.equal(thunderforge.flags.stopAnimationWhenDisabled, true);
        assert.equal(thunderforge.flags.hideAltSpritesWhenDisabled, false);
        assert.equal(thunderforge.flags.hideLightsWhenDisabled, true);
        assert.equal(thunderforge.flags.unfoldWhenFiring, false);
        assert.equal(thunderforge.flags.adjustForOffset, false);

        assert.equal(miner.flags.extraFramePurpose, "folding");
        assert.equal(miner.flags.stopAnimationWhenDisabled, false);
        assert.equal(miner.flags.hideAltSpritesWhenDisabled, false);
        assert.equal(miner.flags.hideLightsWhenDisabled, true);
        assert.equal(miner.flags.unfoldWhenFiring, true);
        assert.equal(miner.flags.adjustForOffset, false);
    });

    it("should parse animDelay", function() {
        // frames per animation frame (assuming 30 fps)
        assert.equal(shuttle.animDelay, 0);
        assert.equal(thunderforge.animDelay, 5);
        assert.equal(miner.animDelay, 5);
    });

    it("should parse weapDecay", function() {
        // rate at which weapon glow goes away
        assert.equal(shuttle.weapDecay, 0);
        assert.equal(thunderforge.weapDecay, 50);
        assert.equal(miner.weapDecay, 0);
    });

    it("should parse framesPer", function() {
        assert.equal(shuttle.framesPer, 36);
        assert.equal(thunderforge.framesPer, 64);
        assert.equal(miner.framesPer, 36);
    });

    it("should parse blink mode", function() {
        assert.equal(thunderforge.blink, null);
        // Necessary for making typescript compile
        assert.propertyVal(shuttle.blink, "mode", "square");
        assert.propertyVal(miner.blink, "mode", "square");
    });

    it("should parse blink a", function() {
        assert.propertyVal(shuttle.blink, "a", 4);
        assert.propertyVal(miner.blink, "a", 4);
    });

    it("should parse blink b", function() {
        assert.propertyVal(shuttle.blink, "b", 1);
        assert.propertyVal(miner.blink, "b", 1);
    });

    it("should parse blink c", function() {
        assert.propertyVal(shuttle.blink, "c", 2);
        assert.propertyVal(miner.blink, "c", 2);
    });

    it("should parse blink d", function() {
        assert.propertyVal(shuttle.blink, "d", 20);
        assert.propertyVal(miner.blink, "d", 20);
    });


    it("should parse shieldImage ID", function() {
        assert.isNull(shuttle.images.shieldImage);
        assert.isNull(thunderforge.images.shieldImage);
        assert.isNull(miner.images.shieldImage);
    });

    // it("should parse shieldImage maskID", function() {
    //     assert.propertyVal(shuttle.images.shieldImage, "maskID", -1);
    //     assert.propertyVal(thunderforge.images.shieldImage, "maskID", -1);
    //     assert.propertyVal(miner.images.shieldImage, "maskID", -1);
    // });
    /*
      it("should parse shieldImage setCount", function() {
      // set this to baseImage setCount (or 0 if no shield image)
      assert.equal(shuttle.shieldImage.setCount, 3);
      assert.equal(thunderforge.shieldImage.setCount, 0);
      assert.equal(miner.shieldImage.setCount, 6);
      });
    */
    // it("should parse shieldImage size", function() {
    //     assert.propertyVal(shuttle.images.shieldImage, "size", [0, 0]);
    //     assert.propertyVal(thunderforge.images.shieldImage, "size", [0, 0]);
    //     assert.propertyVal(miner.images.shieldImage, "size", [0, 0]);
    // });


    it("should parse exitPoints", function() {
        expect(shuttle.exitPoints).to.deep.equal({
            "gun": [[3, 10, -2],
            [-3, 10, -2],
            [3, 10, -2],
            [-3, 10, -2]],
            "turret": [[0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0]],
            "guided": [[0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0]],
            "beam": [[0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0]],
            "upCompress": [100, 71],
            "downCompress": [100, 71]
        });

        expect(thunderforge.exitPoints).to.deep.equal({
            "gun": [[2, -25, 12],
            [-2, -25, 12],
            [2, -32, 16],
            [-2, -32, 16]],
            "turret": [[10, 8, 5],
            [-10, 8, 5],
            [11, -18, 5],
            [-11, -18, 5]],
            "guided": [[18, -16, -7],
            [-18, -16, -7],
            [18, -16, -7],
            [-18, -16, -7]],
            "beam": [[5, 45, 3],
            [5, 45, -3],
            [-6, 45, -3],
            [-6, 45, 3]],
            "upCompress": [130, 80],
            "downCompress": [140, 110]
        });

        expect(miner.exitPoints).to.deep.equal({
            "gun": [[2, 7, 2],
            [-2, 7, -2],
            [-2, 7, 2],
            [2, 7, -2]],
            "turret": [[0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0]],
            "guided": [[0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0]],
            "beam": [[0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0]],
            "upCompress": [0, 0],
            "downCompress": [0, 0]
        });

    });
});


