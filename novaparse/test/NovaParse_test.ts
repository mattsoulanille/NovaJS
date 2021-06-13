import * as fs from "fs";
import "jasmine";
import { BLEND_MODES } from "novadatainterface/BlendModes";
import { WEAP_SPEED_FACTOR } from "novaparse/src/parsers/WeaponParse";
import * as path from "path";
import { PNG } from "pngjs";
import { getDefaultExitPoints } from "../../novadatainterface/Animation";
import { ExplosionData } from "../../novadatainterface/ExplosionData";
import { NovaDataType } from "../../novadatainterface/NovaDataInterface";
import { OutfitData } from "../../novadatainterface/OutiftData";
import { PictImageData } from "../../novadatainterface/PictImage";
import { PlanetData } from "../../novadatainterface/PlanetData";
import { ShipData } from "../../novadatainterface/ShipData";
import { SpriteSheetData, SpriteSheetFramesData, SpriteSheetImageData } from "../../novadatainterface/SpriteSheetData";
import { getDefaultStatusBarColors, getDefaultStatusBarDataAreas } from "../../novadatainterface/StatusBarData";
import { WeaponData } from "../../novadatainterface/WeaponData";
import { NovaParse } from "../NovaParse";
import { FPS, TurnRateConversionFactor } from "../src/parsers/Constants";
import { getPNG } from "./resource_parsers/PNGCompare";

// Bazel no longer patches require.
const runfiles = require(process.env['BAZEL_NODE_RUNFILES_HELPER'] as string) as typeof require;

// TODO: Factor all the resource-specific tests out of
// this file and test them separately. Use mocks instead. 
describe("NovaParse", function() {
    let np: NovaParse;
    let s128: ShipData;
    let s129: ShipData;

    beforeEach(async function() {
        const dataPath = path.join(__dirname, "novaParseTestFilesystem");
        np = new NovaParse(dataPath);
        s128 = await np.data[NovaDataType.Ship].get("nova:128");
        s129 = await np.data[NovaDataType.Ship].get("nova:129");
    });

    it("rejects with NovaIDNotFoundError when the ID is not available", async function() {
        const noShip = np.data[NovaDataType.Ship].get("totally unavailable id");
        await expectAsync(noShip).toBeRejected();
        try {
            await noShip;
            fail("no error thrown");
        } catch (e) {
            //expect(e).toBeInstanceOf(NovaIDNotFoundError);
        }
    });


    // it("Ship should error on missing graphics", async function() {
    //     np.data[NovaDataType.Ship].get("nova:131")
    //         .should.be.rejectedWith(NovaIDNotFoundError);
    // });

    it("Should parse Ship", async function() {
        // Should parse the right Pict for ships that don't have a pict but share their baseImage with another ship
        expect(s129.pict).toEqual(s128.pict);
        const noDesc = np.data[NovaDataType.Ship].get("nova:130");
        try {
            await noDesc;
            fail();
        } catch (e) {
            //expect(e).toBeInstanceOf(NovaIDNotFoundError);
            expect(e.message).toEqual("No matching dësc for shïp of id nova:130");
        }

        expect(s128.pict).toEqual("nova:5000");
        expect(s128.desc).toEqual("a contrived description");
        expect(s128.physics.shield).toEqual(17);
        expect(s128.physics.shieldRecharge).toEqual(18 * FPS / 1000);
        expect(s128.physics.armor).toEqual(19);
        expect(s128.physics.armorRecharge).toEqual(20 * FPS / 1000);
        expect(s128.physics.energy).toEqual(21);
        expect(s128.physics.energyRecharge).toEqual(FPS / 22);
        expect(s128.physics.ionization).toEqual(23);
        expect(s128.physics.deionize).toEqual(24 / 100 * FPS);
        expect(s128.physics.speed).toEqual(12);
        expect(s128.physics.acceleration).toEqual(11);
        expect(s128.physics.turnRate).toEqual(13 * TurnRateConversionFactor);
        expect(s128.physics.mass).toEqual(5678);
        expect(s128.physics.freeMass).toEqual(4234);
        expect(s128.physics.inertialess).toEqual(false);
        expect(s128.displayWeight).toEqual(128);
        expect(s128.deathDelay).toEqual(67 / 30);
        expect(s128.largeExplosion).toEqual(true);
    });

    it("Should parse the right pict ID for ships with the same baseImage", async function() {
        // Ships with the same baseImage as a previous ship that don't have a pictID defined for them get
        // the same pictID as the previous ship's

        const s200 = await np.data[NovaDataType.Ship].get("nova:200");
        // Even though it shares baseImage with s1, it should use its own pict.
        expect(s200.pict).toEqual("nova:5072");
    });

    it("Should parse animations for ships", async function() {
        const anim = s128.animation;
        expect(anim.exitPoints).toEqual({
            gun: [[3, 10, 1], [-3, 10, -2], [3, 10, 3], [-3, 10, -4]],
            turret: [[0, 0, 5], [0, 0, 6], [0, 0, 7], [0, 0, 8]],
            guided: [[0, 0, 9], [0, 0, 10], [0, 0, 11], [0, 0, 12]],
            beam: [[0, 0, 13], [0, 0, 14], [0, 0, 15], [0, 0, 16]],
            upCompress: [100, 71],
            downCompress: [81, 91]
        });

        expect(anim.id).toEqual("nova:128");
        expect(anim.images.baseImage).toEqual({
            id: 'nova:1000',
            dataType: NovaDataType.SpriteSheetImage,
            blendMode: BLEND_MODES.NORMAL,
            frames:
            {
                normal: { start: 0, length: 36 },
                left: { start: 36, length: 36 },
                right: { start: 72, length: 36 }
            }
        });

        // s1 has no alt image
        expect(anim.images.altImage).not.toBeDefined();
    });

    it("Should parse which explosion a ship has", async function() {
        expect(s128.initialExplosion!).toEqual("nova:168");
        expect(s128.finalExplosion!).toEqual("nova:169");
        expect(s129.initialExplosion!).toEqual("nova:132");
        expect(s129.finalExplosion!).toEqual("nova:133");
    });

    it("Should parse explosions", async function() {
        const e132: ExplosionData = await np.data.Explosion.get("nova:132");
        expect(e132.animation.images).toEqual({
            baseImage: {
                id: "nova:1600",
                dataType: NovaDataType.SpriteSheetImage,
                blendMode: BLEND_MODES.ADD,
                frames: {
                    normal: { start: 0, length: 108 }
                }
            }
        });

        expect(e132.rate).toEqual(0.83);
    });

    it("Should parse ship outfits including weapons", async function() {
        expect(s128.outfits).toEqual({
            "nova:150": 26,
            "nova:151": 38,
            "nova:130": 50,
            "nova:131": 58
        });
    });

    it("Should parse outfit physics", async function() {
        const o131: OutfitData = await np.data.Outfit.get("nova:131");
        expect(o131.physics).toEqual({
            freeMass: 73,
            freeCargo: 123,
            shield: 55,
            armor: 45,
            energyRecharge: FPS / 100
        });
    });

    it("Should parse projectileWeapon", async function() {
        const w132: WeaponData = await np.data.Weapon.get("nova:132");

        if (w132.type !== "ProjectileWeaponData") {
            fail("Expected w132 to be a projectile weapon");
        }
        else {
            // Now it is known that w132 is a projectileWeapon.
            expect(w132.physics).toEqual({
                acceleration: 0,
                armorRecharge: 0,
                deionize: 0,
                energy: 0,
                energyRecharge: 0,
                ionization: 0,
                mass: 0,
                shieldRecharge: 0,
                speed: 17 * WEAP_SPEED_FACTOR,
                turnRate: 0,
                shield: 0,
                armor: 0,
                inertialess: false,
            });
            expect(w132.animation).toEqual({
                exitPoints: getDefaultExitPoints(),
                id: w132.id,
                name: w132.name,
                prefix: w132.prefix,
                images: {
                    baseImage: {
                        id: "nova:1600",
                        dataType: NovaDataType.SpriteSheetImage,
                        blendMode: BLEND_MODES.NORMAL,
                        frames: {
                            "normal": { start: 0, length: 108 }
                        }
                    }
                }
            });
        }
    });

    it("Should parse beamWeapon", async function() {
        const w133: WeaponData = await np.data.Weapon.get("nova:133");
        if (w133.type !== "BeamWeaponData") {
            fail("Expected w133 to be a beam weapon");
        }
        else {
            expect(w133.beamAnimation).toEqual({
                beamColor: 0xFF151617,
                coronaColor: 0xFF191A1B,
                coronaFalloff: 24,
                length: 19,
                width: 20
            });
        }
    });

    it("Should parse PictImage", async function() {
        const p700: PictImageData = await np.data.PictImage.get("nova:700");
        const statusBarPath = runfiles.resolve("novajs/novaparse/test/resource_parsers/files/picts/statusBar.png");
        const statusBar = await getPNG(statusBarPath);

        expect(p700).toEqual(PNG.sync.write(statusBar).buffer);
    });

    it("Should parse Planet", async function() {
        const p128: PlanetData = await np.data.Planet.get("nova:128");
        expect(p128.landingDesc).toEqual("Hello. I'm a planet!");
        expect(p128.landingPict).toEqual("nova:10003");
    });

    it("Should parse SpriteSheetImage", async function() {
        const ri1000: SpriteSheetImageData = await np.data.SpriteSheetImage.get("nova:1000");
        const shuttlePath = runfiles.resolve("novajs/novaparse/test/testSpriteSheetImage.png");
        const shuttle = fs.readFileSync(shuttlePath);
        expect(ri1000).toEqual(shuttle.buffer);
    });

    it("Should parse SpriteSheetFrames", async function() {
        const rf1116: SpriteSheetFramesData =
            await np.data.SpriteSheetFrames.get("nova:1116");

        const frames1116Path = runfiles.resolve("novajs/novaparse/test/zephyrFrames.json");
        const shouldEqual1116 = JSON.parse(fs.readFileSync(
            frames1116Path, "utf8")) as SpriteSheetFramesData;
        expect(rf1116).toEqual(shouldEqual1116);

        const rf1000: SpriteSheetFramesData =
            await np.data.SpriteSheetFrames.get("nova:1000");

        const frames1000Path =
            runfiles.resolve("novajs/novaparse/test/testSpriteSheetFrames.json");
        const shouldEqual1000 = JSON.parse(fs.readFileSync(
            frames1000Path, "utf8")) as SpriteSheetFramesData;
        expect(rf1000).toEqual(shouldEqual1000);
    });

    it("Should parse SpriteSheet", async function() {
        const rs1000: SpriteSheetData = await np.data.SpriteSheet.get("nova:1000");
        const sheet1000Path =
            runfiles.resolve("novajs/novaparse/test/testSpriteSheet.json");
        const expectedSpriteSheet = JSON.parse(fs.readFileSync(
            sheet1000Path, "utf8")) as SpriteSheetData;

        var noNegativeZeroes = JSON.parse(JSON.stringify(rs1000)) as SpriteSheetData;
        expect(noNegativeZeroes).toEqual(expectedSpriteSheet);
    });

    it("Should produce the default StatusBar", async function() {
        const sb128 = await np.data.StatusBar.get("nova:128");
        expect(sb128.colors).toEqual(getDefaultStatusBarColors());
        expect(sb128.dataAreas).toEqual(getDefaultStatusBarDataAreas());
        expect(sb128.image).toEqual("nova:700");
    });

    it("Should parse ids", async function() {
        const ids = await np.ids;
        expect(ids.Weapon).toEqual([
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
        const s128 = await np.data.System.get("nova:128");
        expect(s128.planets).toEqual(['nova:128', 'nova:189', 'nova:194']);
    });

    it("Should parse planet position", async function() {
        const p194 = await np.data.Planet.get("nova:194");
        expect(p194.position).toEqual([22, -56]);
    });

    it("Should load Plug-ins in reverse alphabetical order", async function() {
        const s201 = await np.data.Ship.get("nova:202");
        expect(s201.desc).toEqual("This should overwrite the Loaded Before plug-in");
    });

    it("Should defer throwing of errors to when specific resources are requested", async function() {
        const brokenNovaParse = new NovaParse("./not/a/real/path/");
        const data = brokenNovaParse.data;

        await expectAsync(data[NovaDataType.Ship].get("nova:128")).toBeRejected();
        await expectAsync(data[NovaDataType.Outfit].get("nova:128")).toBeRejected();
        await expectAsync(data[NovaDataType.Planet].get("nova:128")).toBeRejected();
    });
});
