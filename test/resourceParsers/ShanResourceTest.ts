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
        assert.equal(shuttle.baseImage.ID, 1000);
        assert.equal(thunderforge.baseImage.ID, 1130);
        assert.equal(miner.baseImage.ID, 1128);
    });

    it("should parse baseImage maskID", function() {
        assert.equal(shuttle.baseImage.maskID, 1001);
        assert.equal(thunderforge.baseImage.maskID, 1131);
        assert.equal(miner.baseImage.maskID, 1129);
    });

    it("should parse baseImage setCount", function() {
        // number of sets of images (rotations / animations)
        assert.equal(shuttle.baseImage.setCount, 3);
        assert.equal(thunderforge.baseImage.setCount, 1);
        assert.equal(miner.baseImage.setCount, 6);
    });

    it("should parse baseImage size", function() {
        assert.equal(shuttle.baseImage.size[0], 24);
        assert.equal(shuttle.baseImage.size[1], 24);
        assert.equal(thunderforge.baseImage.size[0], 130);
        assert.equal(thunderforge.baseImage.size[1], 130);
        assert.equal(miner.baseImage.size[0], 80);
        assert.equal(miner.baseImage.size[1], 80);
    });

    it("should parse baseImage.transparency", function() {
        assert.equal(shuttle.baseImage.transparency, 0);
        assert.equal(thunderforge.baseImage.transparency, 0);
        assert.equal(miner.baseImage.transparency, 0);
    });

    it("should parse altImage ID", function() {
        assert.equal(shuttle.altImage.ID, -1);
        assert.equal(thunderforge.altImage.ID, 1330);
        assert.equal(miner.altImage.ID, -1);
    });

    it("should parse altImage maskID", function() {
        assert.equal(shuttle.altImage.maskID, -1);
        assert.equal(thunderforge.altImage.maskID, 1331);
        assert.equal(miner.altImage.maskID, -1);
    });

    it("should parse altImage setCount", function() {
        assert.equal(shuttle.altImage.setCount, 0);
        assert.equal(thunderforge.altImage.setCount, 6);
        assert.equal(miner.altImage.setCount, 0);
    });

    it("should parse altImage size", function() {
        assert.equal(shuttle.altImage.size[0], 0);
        assert.equal(shuttle.altImage.size[1], 0);
        assert.equal(thunderforge.altImage.size[0], 260);
        assert.equal(thunderforge.altImage.size[1], 260);
        assert.equal(miner.altImage.size[0], 0);
        assert.equal(miner.altImage.size[1], 0);
    });

    it("should parse glowImage ID", function() {
        assert.equal(shuttle.glowImage.ID, 1400);
        assert.equal(thunderforge.glowImage.ID, 1530);
        assert.equal(miner.glowImage.ID, 1528);
    });

    it("should parse glowImage maskID", function() {
        assert.equal(shuttle.glowImage.maskID, 1401);
        assert.equal(thunderforge.glowImage.maskID, 1531);
        assert.equal(miner.glowImage.maskID, 1529);
    });
    /*
      it("should parse glowImage setCount", function() {
      // set this to baseImage setCount (or 0 if no glow image)
      assert.equal(shuttle.glowImage.setCount, 3);
      assert.equal(thunderforge.glowImage.setCount, 1);
      assert.equal(miner.glowImage.setCount, 6);
      });
    */
    it("should parse glowImage size", function() {
        assert.equal(shuttle.glowImage.size[0], 48);
        assert.equal(shuttle.glowImage.size[1], 48);
        assert.equal(thunderforge.glowImage.size[0], 260);
        assert.equal(thunderforge.glowImage.size[1], 260);
        assert.equal(miner.glowImage.size[0], 80);
        assert.equal(miner.glowImage.size[1], 80);
    });

    it("should parse lightImage ID", function() {
        assert.equal(shuttle.lightImage.ID, 1600);
        assert.equal(thunderforge.lightImage.ID, -1);
        assert.equal(miner.lightImage.ID, 1728);
    });

    it("should parse lightImage maskID", function() {
        assert.equal(shuttle.lightImage.maskID, 1601);
        assert.equal(thunderforge.lightImage.maskID, -1);
        assert.equal(miner.lightImage.maskID, 1729);
    });
    /*
      it("should parse lightImage setCount", function() {
      // set this to baseImage setCount (or 0 if no light image)
      assert.equal(shuttle.lightImage.setCount, 3);
      assert.equal(thunderforge.lightImage.setCount, 0);
      assert.equal(miner.lightImage.setCount, 6);
      });
    */
    it("should parse lightImage size", function() {
        assert.equal(shuttle.lightImage.size[0], 48);
        assert.equal(shuttle.lightImage.size[1], 48);
        assert.equal(thunderforge.lightImage.size[0], 0);
        assert.equal(thunderforge.lightImage.size[1], 0);
        assert.equal(miner.lightImage.size[0], 80);
        assert.equal(miner.lightImage.size[1], 80);
    });

    it("should parse weapImage ID", function() {
        assert.equal(shuttle.weapImage.ID, -1);
        assert.equal(thunderforge.weapImage.ID, 1930);
        assert.equal(miner.weapImage.ID, -1);
    });

    it("should parse weapImage maskID", function() {
        assert.equal(shuttle.weapImage.maskID, -1);
        assert.equal(thunderforge.weapImage.maskID, 1931);
        assert.equal(miner.weapImage.maskID, -1);
    });
    /*
      it("should parse weapImage setCount", function() {
      // set this to baseImage setCount (or 0 if no weap image)
      assert.equal(shuttle.weapImage.setCount, 0);
      assert.equal(thunderforge.weapImage.setCount, 1);
      assert.equal(miner.weapImage.setCount, 0);
      });
    */
    it("should parse weapImage size", function() {
        assert.equal(shuttle.weapImage.size[0], 0);
        assert.equal(shuttle.weapImage.size[1], 0);
        assert.equal(thunderforge.weapImage.size[0], 260);
        assert.equal(thunderforge.weapImage.size[1], 260);
        assert.equal(miner.weapImage.size[0], 0);
        assert.equal(miner.weapImage.size[1], 0);
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
        assert.equal(shuttle.shieldImage.ID, -1);
        assert.equal(thunderforge.shieldImage.ID, -1);
        assert.equal(miner.shieldImage.ID, -1);
    });

    it("should parse shieldImage maskID", function() {
        assert.equal(shuttle.shieldImage.maskID, -1);
        assert.equal(thunderforge.shieldImage.maskID, -1);
        assert.equal(miner.shieldImage.maskID, -1);
    });
    /*
      it("should parse shieldImage setCount", function() {
      // set this to baseImage setCount (or 0 if no shield image)
      assert.equal(shuttle.shieldImage.setCount, 3);
      assert.equal(thunderforge.shieldImage.setCount, 0);
      assert.equal(miner.shieldImage.setCount, 6);
      });
    */
    it("should parse shieldImage size", function() {
        assert.equal(shuttle.shieldImage.size[0], 0);
        assert.equal(shuttle.shieldImage.size[1], 0);
        assert.equal(thunderforge.shieldImage.size[0], 0);
        assert.equal(thunderforge.shieldImage.size[1], 0);
        assert.equal(miner.shieldImage.size[0], 0);
        assert.equal(miner.shieldImage.size[1], 0);
    });


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


