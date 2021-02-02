import "jasmine";
import { readResourceFork, ResourceMap } from "resourceforkjs";
import { ShanResource } from "../../src/resource_parsers/ShanResource";
import { defaultIDSpace } from "./DefaultIDSpace";


describe("ShanResource", function() {
    // Shans don't depend on other resources.
    const idSpace = defaultIDSpace;

    let rf: ResourceMap;
    let miner: ShanResource;
    let thunderforge: ShanResource;
    let shuttle: ShanResource;

    beforeEach(async function() {
        const dataPath = require.resolve("novajs/novaparse/test/resource_parsers/files/shan.ndat");
        rf = await readResourceFork(dataPath, false);

        const shans = rf.shän;
        shuttle = new ShanResource(shans[128], idSpace);
        thunderforge = new ShanResource(shans[380], idSpace);
        miner = new ShanResource(shans[379], idSpace);
    });

    it("should parse baseImage ID", function() {
        expect(shuttle.images.baseImage.ID).toEqual(1000);
        expect(thunderforge.images.baseImage.ID).toEqual(1130);
        expect(miner.images.baseImage.ID).toEqual(1128);
    });

    it("should parse baseImage maskID", function() {
        expect(shuttle.images.baseImage.maskID).toEqual(1001);
        expect(thunderforge.images.baseImage.maskID).toEqual(1131);
        expect(miner.images.baseImage.maskID).toEqual(1129);
    });

    it("should parse baseImage setCount", function() {
        // number of sets of images (rotations / animations)
        expect(shuttle.images.baseImage.setCount).toEqual(3);
        expect(thunderforge.images.baseImage.setCount).toEqual(1);
        expect(miner.images.baseImage.setCount).toEqual(6);
    });

    it("should parse baseImage size", function() {
        expect(shuttle.images.baseImage.size).toEqual([24, 24]);
        expect(thunderforge.images.baseImage.size).toEqual([130, 130]);
        expect(miner.images.baseImage.size).toEqual([80, 80]);
    });

    it("should parse baseImage.transparency", function() {
        expect(shuttle.images.baseImage.transparency).toEqual(0);
        expect(thunderforge.images.baseImage.transparency).toEqual(0);
        expect(miner.images.baseImage.transparency).toEqual(0);
    });

    it("should parse altImage ID", function() {
        expect(shuttle.images.altImage).toBeNull();
        expect(thunderforge.images.altImage!.ID).toEqual(1330);
        expect(miner.images.altImage).toBeNull();
    });

    it("should parse altImage maskID", function() {
        expect(thunderforge.images.altImage!.maskID).toEqual(1331);
    });

    it("should parse altImage setCount", function() {
        expect(thunderforge.images.altImage!.setCount).toEqual(6);
    });

    it("should parse altImage size", function() {
        expect(thunderforge.images.altImage!.size).toEqual([260, 260]);
    });

    it("should parse glowImage ID", function() {
        expect(shuttle.images.glowImage!.ID).toEqual(1400);
        expect(thunderforge.images.glowImage!.ID).toEqual(1530);
        expect(miner.images.glowImage!.ID).toEqual(1528);
    });

    it("should parse glowImage maskID", function() {
        expect(shuttle.images.glowImage!.maskID).toEqual(1401);
        expect(thunderforge.images.glowImage!.maskID).toEqual(1531);
        expect(miner.images.glowImage!.maskID).toEqual(1529);
    });
    /*
      it("should parse glowImage setCount", function() {
      // set this to .images.baseImage setCount (or 0 if no glow image)
      expect(shuttle.images.glowImag.setCount).toEqual(3);
      expect(thunderforge.images.glowImag.setCount).toEqual(1);
      expect(miner.images.glowImag.setCount).toEqual(6);
      });
    */
    it("should parse glowImage size", function() {
        expect(shuttle.images.glowImage!.size).toEqual([48, 48]);
        expect(thunderforge.images.glowImage!.size).toEqual([260, 260]);
        expect(miner.images.glowImage!.size).toEqual([80, 80]);
    });

    it("should parse lightImage ID", function() {
        expect(shuttle.images.lightImage!.ID).toEqual(1600);
        expect(thunderforge.images.lightImage).toBeNull();
        expect(miner.images.lightImage!.ID).toEqual(1728);
    });

    it("should parse lightImage maskID", function() {
        expect(shuttle.images.lightImage!.maskID).toEqual(1601);
        expect(miner.images.lightImage!.maskID).toEqual(1729);
    });
    /*
      it("should parse lightImage setCount", function() {
      // set this to baseImage setCount (or 0 if no light image)
      expect(shuttle.images.lightImag.setCount).toEqual(3);
      expect(thunderforge.images.lightImag.setCount).toEqual(0);
      expect(miner.images.lightImag.setCount).toEqual(6);
      });
    */
    it("should parse lightImage size", function() {
        expect(shuttle.images.lightImage!.size).toEqual([48, 48]);
        expect(miner.images.lightImage!.size).toEqual([80, 80]);
    });

    it("should parse weapImage ID", function() {
        expect(shuttle.images.weapImage).toBeNull();
        expect(thunderforge.images.weapImage!.ID).toEqual(1930);
        expect(miner.images.weapImage).toBeNull();
    });

    it("should parse weapImage maskID", function() {
        expect(thunderforge.images.weapImage!.maskID).toEqual(1931);
    });
    /*
      it("should parse weapImage setCount", function() {
      // set this to baseImage setCount (or 0 if no weap image)
      expect(shuttle.images.weapImag.setCount).toEqual(0);
      expect(thunderforge.images.weapImag.setCount).toEqual(1);
      expect(miner.images.weapImag.setCount).toEqual(0);
      });
    */
    it("should parse weapImage size", function() {
        expect(thunderforge.images.weapImage!.size).toEqual([260, 260]);
    });


    it("should parse flags", function() {
        expect(shuttle.flags.extraFramePurpose).toEqual("banking");
        expect(shuttle.flags.stopAnimationWhenDisabled).toBe(false);
        expect(shuttle.flags.hideAltSpritesWhenDisabled).toBe(false);
        expect(shuttle.flags.hideLightsWhenDisabled).toBe(true);
        expect(shuttle.flags.unfoldWhenFiring).toBe(false);
        expect(shuttle.flags.adjustForOffset).toBe(false);

        expect(thunderforge.flags.extraFramePurpose).toEqual("animation");
        expect(thunderforge.flags.stopAnimationWhenDisabled).toBe(true);
        expect(thunderforge.flags.hideAltSpritesWhenDisabled).toBe(false);
        expect(thunderforge.flags.hideLightsWhenDisabled).toBe(true);
        expect(thunderforge.flags.unfoldWhenFiring).toBe(false);
        expect(thunderforge.flags.adjustForOffset).toBe(false);

        expect(miner.flags.extraFramePurpose).toEqual("folding");
        expect(miner.flags.stopAnimationWhenDisabled).toBe(false);
        expect(miner.flags.hideAltSpritesWhenDisabled).toBe(false);
        expect(miner.flags.hideLightsWhenDisabled).toBe(true);
        expect(miner.flags.unfoldWhenFiring).toBe(true);
        expect(miner.flags.adjustForOffset).toBe(false);
    });

    it("should parse animDelay", function() {
        // frames per animation frame (assuming 30 fps)
        expect(shuttle.animDelay).toEqual(0);
        expect(thunderforge.animDelay).toEqual(5);
        expect(miner.animDelay).toEqual(5);
    });

    it("should parse weapDecay", function() {
        // rate at which weapon glow goes away
        expect(shuttle.weapDecay).toEqual(0);
        expect(thunderforge.weapDecay).toEqual(50);
        expect(miner.weapDecay).toEqual(0);
    });

    it("should parse framesPer", function() {
        expect(shuttle.framesPer).toEqual(36);
        expect(thunderforge.framesPer).toEqual(64);
        expect(miner.framesPer).toEqual(36);
    });

    it("should parse blink mode", function() {
        expect(thunderforge.blink).toEqual(null);
        expect(shuttle.blink!.mode).toEqual("square");
        expect(miner.blink!.mode).toEqual("square");
    });

    it("should parse blink a", function() {
        expect(shuttle.blink!.a).toEqual(4);
        expect(miner.blink!.a).toEqual(4);
    });

    it("should parse blink b", function() {
        expect(shuttle.blink!.b).toEqual(1);
        expect(miner.blink!.b).toEqual(1);
    });

    it("should parse blink c", function() {
        expect(shuttle.blink!.c).toEqual(2);
        expect(miner.blink!.c).toEqual(2);
    });

    it("should parse blink d", function() {
        expect(shuttle.blink!.d).toEqual(20);
        expect(miner.blink!.d).toEqual(20);
    });

    it("should parse shieldImage ID", function() {
        expect(shuttle.images.shieldImage).toBeNull();
        expect(thunderforge.images.shieldImage).toBeNull();
        expect(miner.images.shieldImage).toBeNull();
    });

    // it("should parse shieldImage maskID", function() {
    //    expect(shuttle.images.shieldImage.maskID).toEqual(-1);
    //    expect(thunderforge.images.shieldImage.maskID).toEqual(-1);
    //    expect(miner.images.shieldImage.maskID).toEqual(-1);
    // });
    /*
      it("should parse shieldImage setCount", function() {
      // set this to baseImage setCount (or 0 if no shield image)
      expect(shuttle.shieldImage.setCount).toEqual(3);
      expect(thunderforge.shieldImage.setCount).toEqual(0);
      expect(miner.shieldImage.setCount).toEqual(6);
      });
    */
    // it("should parse shieldImage size", function() {
    //    expect(shuttle.images.shieldImage, "size".0).toEqual(]);
    //    expect(thunderforge.images.shieldImage, "size".0).toEqual(]);
    //    expect(miner.images.shieldImage, "size".0).toEqual(]);
    // });


    it("should parse exitPoints", function() {
        expect(shuttle.exitPoints).toEqual({
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

        expect(thunderforge.exitPoints).toEqual({
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

        expect(miner.exitPoints).toEqual({
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
