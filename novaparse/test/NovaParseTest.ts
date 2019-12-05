global.Promise = require("bluebird"); // For stacktraces

import * as fs from "fs";

import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import "mocha";
import { readResourceFork, ResourceMap } from "resourceforkjs";
import { assert } from "chai";
import { NovaParse } from "../src/NovaParse";
import { NovaResourceType } from "../src/ResourceHolderBase";
import { NovaDataInterface, NovaDataType, NovaIDNotFoundError } from "novadatainterface/NovaDataInterface";
import { ShipData } from "novadatainterface/ShipData";
import { BaseData } from "novadatainterface/BaseData";
import { ShipResource } from "../src/resource_parsers/ShipResource";
import { TurnRateConversionFactor, FPS } from "../src/parsers/Constants";
import { OutfitData } from "novadatainterface/OutiftData";
import { ExplosionData } from "novadatainterface/ExplosionData";
import { WeaponData } from "novadatainterface/WeaponData";
import { DefaultExitPoints } from "novadatainterface/Animation";
import { PictData } from "novadatainterface/PictData";
import { comparePNGs, getPNG } from "./resource_parsers/PNGCompare";
import { PNG } from "pngjs";
import { PlanetData } from "novadatainterface/PlanetData";
import { SpriteSheetFramesData, SpriteSheetImageData, SpriteSheetData } from "novadatainterface/SpriteSheetData";
import { DefaultStatusBarColors, DefaultStatusBarDataAreas } from "novadatainterface/StatusBarData";
import { PictImageData } from "novadatainterface/PictImage";
import { BadDirectoryStructureError } from "../src/IDSpaceHandler";

before(function() {
    chai.should();
    chai.use(chaiAsPromised);
});

const expect = chai.expect;


async function expectNovaError(parseFunction: () => Promise<BaseData>, messageVal: string | null = null) {
    try {
        var d = await parseFunction();
    }
    catch (e) {
        expect(e).to.be.an.instanceOf(NovaIDNotFoundError);
        if (messageVal !== null) {
            expect(e.message).to.equal(messageVal);
        }
    }
}


describe("NovaParse", function() {

    var np: NovaParse;

    var s128: ShipData;
    var s129: ShipData;

    before(async function() {
        np = new NovaParse("./test/novaParseTestFilesystem");
        s128 = await np.data[NovaDataType.Ship].get("nova:128");
        s129 = await np.data[NovaDataType.Ship].get("nova:129");
    });

    it("Should produce the correct error when the ID is not available", async function() {
        np.data[NovaDataType.Ship].get("totally unavailable id")
            .should.be.rejectedWith(NovaIDNotFoundError);
    });


    // it("Ship should error on missing graphics", async function() {
    //     np.data[NovaDataType.Ship].get("nova:131")
    //         .should.be.rejectedWith(NovaIDNotFoundError);
    // });

    it("Should parse Ship", async function() {


        // Should parse the right Pict for ships that don't have a pict but share their baseImage with another ship


        s129.pict.should.equal(s128.pict);



        await np.data[NovaDataType.Ship].get("nova:130")
            .should.be.rejectedWith(NovaIDNotFoundError, "No matching dësc for shïp of id nova:130");


        s128.pict.should.equal("nova:5000");
        s128.desc.should.equal("a contrived description");

        s128.physics.shield.should.equal(17);
        s128.physics.shieldRecharge.should.equal(18 * FPS / 1000);
        s128.physics.armor.should.equal(19);
        s128.physics.armorRecharge.should.equal(20 * FPS / 1000);
        s128.physics.energy.should.equal(21);
        s128.physics.energyRecharge.should.equal(FPS / 22);
        s128.physics.ionization.should.equal(23);
        s128.physics.deionize.should.equal(24 / 100 * FPS);
        s128.physics.speed.should.equal(12);
        s128.physics.acceleration.should.equal(11);
        s128.physics.turnRate.should.equal(13 * TurnRateConversionFactor);
        s128.physics.mass.should.equal(5678);
        s128.physics.freeMass.should.equal(4234);

        s128.displayWeight.should.equal(128);
        s128.deathDelay.should.equal(67 / 30);
        s128.largeExplosion.should.equal(true);

    });

    it("Should parse the right pict ID for ships with the same baseImage", async function() {
        // Ships with the same baseImage as a previous ship that don't have a pictID defined for them get
        // the same pictID as the previous ship's

        var s200 = await np.data[NovaDataType.Ship].get("nova:200");
        // Even though it shares baseImage with s1, it should use its own pict.
        s200.pict.should.equal("nova:5072");
    });

    it("Should parse animations for ships", async function() {

        var anim = s128.animation;
        anim.exitPoints.should.deep.equal({
            gun: [[3, 10, 1], [-3, 10, -2], [3, 10, 3], [-3, 10, -4]],
            turret: [[0, 0, 5], [0, 0, 6], [0, 0, 7], [0, 0, 8]],
            guided: [[0, 0, 9], [0, 0, 10], [0, 0, 11], [0, 0, 12]],
            beam: [[0, 0, 13], [0, 0, 14], [0, 0, 15], [0, 0, 16]],
            upCompress: [100, 71],
            downCompress: [81, 91]
        });

        anim.id.should.equal("nova:128");
        anim.images.baseImage.should.deep.equal({
            id: 'nova:1000',
            imagePurposes:
            {
                normal: { start: 0, length: 36 },
                left: { start: 36, length: 36 },
                right: { start: 72, length: 36 }
            }
        });

        // s1 has no alt image
        anim.images.should.not.haveOwnProperty("altImage");
    });

    it("Should parse which explosion a ship has", async function() {
        assert.propertyVal(s128, "initialExplosion", "nova:168");
        assert.propertyVal(s128, "finalExplosion", "nova:169");
        assert.propertyVal(s129, "initialExplosion", "nova:132");
        assert.propertyVal(s129, "finalExplosion", "nova:133");
    });

    it("Should parse explosions", async function() {
        let e132: ExplosionData = await np.data.Explosion.get("nova:132");
        e132.animation.images.should.deep.equal({
            baseImage: {
                id: "nova:1600",
                imagePurposes: {
                    normal: { start: 0, length: 108 }
                }
            }
        });

        e132.rate.should.equal(0.83);
    });

    it("Should parse ship outfits including weapons", async function() {
        s128.outfits.should.deep.equal({
            "nova:150": 26,
            "nova:151": 38,
            "nova:130": 50,
            "nova:131": 58
        });
    });

    it("Should parse outfit physics", async function() {
        let o131: OutfitData = await np.data.Outfit.get("nova:131");
        o131.physics.should.deep.equal({
            freeMass: 73,
            freeCargo: 123,
            shield: 55,
            armor: 45,
            energyRecharge: FPS / 100
        });
    });

    it("Should parse projectileWeapon", async function() {
        var w132: WeaponData = await np.data.Weapon.get("nova:132");

        if (w132.type !== "ProjectileWeaponData") {
            assert.fail("Expected w132 to be a projectile weapon");
        }
        else {
            // Now it is known that w132 is a projectileWeapon.
            w132.physics.should.deep.equal({
                acceleration: 0,
                armorRecharge: 0,
                deionize: 0,
                energy: 0,
                energyRecharge: 0,
                ionization: 0,
                mass: 0,
                shieldRecharge: 0,
                speed: 17,
                turnRate: 0,
                shield: 0,
                armor: 0
            });
            w132.animation.should.deep.equal({
                exitPoints: DefaultExitPoints,
                id: w132.id,
                name: w132.name,
                prefix: w132.prefix,
                images: {
                    baseImage: {
                        id: "nova:1600",
                        imagePurposes: {
                            "normal": { start: 0, length: 108 }
                        }
                    }
                }
            });
        }
    });
    it("Should parse beamWeapon", async function() {
        var w133: WeaponData = await np.data.Weapon.get("nova:133");
        if (w133.type !== "BeamWeaponData") {
            assert.fail("Expected w133 to be a beam weapon");
        }
        else {
            w133.beamAnimation.should.deep.equal({
                beamColor: 0xFF151617,
                coronaColor: 0xFF191A1B,
                coronaFalloff: 24,
                length: 19,
                width: 20
            });
        }
    });

    it("Should parse PictImage", async function() {
        var p700: PictImageData = await np.data.PictImage.get("nova:700");
        var statusBar = await getPNG("./test/resource_parsers/files/picts/statusBar.png");

        p700.should.deep.equal(PNG.sync.write(statusBar));
    });

    it("Should parse Planet", async function() {
        var p128: PlanetData = await np.data.Planet.get("nova:128");
        p128.landingDesc.should.equal("Hello. I'm a planet!");
        p128.landingPict.should.equal("nova:10003");
    });

    it("Should parse SpriteSheetImage", async function() {
        var ri1000: SpriteSheetImageData = await np.data.SpriteSheetImage.get("nova:1000");
        var shuttle = fs.readFileSync("./test/testSpriteSheetImage.png");
        ri1000.should.deep.equal(shuttle, "err");
    });

    it("Should parse SpriteSheetFrames", async function() {
        var rf1116: SpriteSheetFramesData = await np.data.SpriteSheetFrames.get("nova:1116");
        var shouldEqual1116 = JSON.parse(fs.readFileSync("./test/zephyrFrames.json", "utf8"));
        rf1116.should.deep.equal(shouldEqual1116);


        var rf1000: SpriteSheetFramesData = await np.data.SpriteSheetFrames.get("nova:1000");
        var shouldEqual1000 = JSON.parse(fs.readFileSync("./test/testSpriteSheetFrames.json", "utf8"));
        rf1000.should.deep.equal(shouldEqual1000);



    });

    it("Should parse SpriteSheet", async function() {
        var rs1000: SpriteSheetData = await np.data.SpriteSheet.get("nova:1000");
        var shouldEqual = JSON.parse(fs.readFileSync("./test/testSpriteSheet.json", "utf8"));

        // Chai thinks that -0 !== 0
        var noNegativeZeroes = JSON.parse(JSON.stringify(rs1000));
        noNegativeZeroes.should.deep.equal(shouldEqual);
    });

    it("Should produce the default StatusBar", async function() {
        var sb128 = await np.data.StatusBar.get("nova:128");
        sb128.colors.should.deep.equal(DefaultStatusBarColors);
        sb128.dataAreas.should.deep.equal(DefaultStatusBarDataAreas);
        sb128.image.should.equal("nova:700");
    });

    it("Should parse ids", async function() {
        var ids = await np.ids;
        ids.Weapon.should.deep.equal([
            'nova:128',
            'nova:129',
            'nova:130',
            'nova:131',
            'nova:132',
            'nova:133',
            'nova:300'],
        );
    });

    it("Should parse system planets", async function() {
        var s128 = await np.data.System.get("nova:128");
        s128.planets.should.deep.equal(['nova:128', 'nova:189', 'nova:194']);
    });

    it("Should parse planet position", async function() {
        var p194 = await np.data.Planet.get("nova:194");
        p194.position.should.deep.equal([22, -56]);

    });
    it("Should load Plug-ins in reverse alphabetical order", async function() {
        var s201 = await np.data.Ship.get("nova:202");
        s201.desc.should.equal("This should overwrite the Loaded Before plug-in");
    });

    it("Should defer throwing of errors to when specific resources are requested", async function() {
        var brokenNovaParse = new NovaParse("./not/a/real/path/");

        brokenNovaParse.data[NovaDataType.Ship].get("nova:128").should.be.rejectedWith(BadDirectoryStructureError);
        brokenNovaParse.data[NovaDataType.Outfit].get("nova:128").should.be.rejectedWith(BadDirectoryStructureError);
        brokenNovaParse.data[NovaDataType.Planet].get("nova:128").should.be.rejectedWith(BadDirectoryStructureError);
    });
});

