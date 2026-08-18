import * as fs from "fs";
import "jasmine";
import { BLEND_MODES } from "novadatainterface/blend_modes";
import { WEAP_SPEED_FACTOR } from "../src/parsers/weapon_parse.js";
import * as path from "path";
import { PNG } from "pngjs";
import { getDefaultExitPoints } from "novadatainterface/animation";
import { ExplosionData } from "novadatainterface/explosion_data";
import { NovaDataType } from "novadatainterface/nova_data_interface";
import { OutfitData } from "novadatainterface/outfit_data";
import { PictImageData } from "novadatainterface/pict_image";
import { PlanetData } from "novadatainterface/planet_data";
import { ShipData } from "novadatainterface/ship_data";
import { SpriteSheetData, SpriteSheetFramesData, SpriteSheetImageData } from "novadatainterface/sprite_sheet_data";
import { getDefaultStatusBarColors, getDefaultStatusBarDataAreas } from "novadatainterface/status_bar_data";
import { WeaponData } from "novadatainterface/weapon_data";
import { NovaParse } from "../src/nova_parse.js";
import { FPS, ShipAccelerationConversionFactor, ShipSpeedConversionFactor, ShipTurnRateConversionFactor } from "../src/parsers/constants.js";
import { getPNG } from "./resource_parsers/png_compare.js";
import { resolveFixture } from './fixtures.js';

// TODO: Factor all the resource-specific tests out of
// this file and test them separately.
describe("NovaParse", () => {
    let np: NovaParse;
    let s128: ShipData;
    let s129: ShipData;

    beforeEach(async () => {
        const dataPath = resolveFixture("novaParseTestFilesystem");
        np = new NovaParse(dataPath);
        s128 = await np.data[NovaDataType.Ship].get("nova:128");
        s129 = await np.data[NovaDataType.Ship].get("nova:129");
    });

    it("rejects with NovaIDNotFoundError when the ID is not available", async () => {
        const noShip = np.data[NovaDataType.Ship].get("totally unavailable id");
        await expectAsync(noShip).toBeRejected();
        try {
            await noShip;
            fail("no error thrown");
        } catch (e) {
            //expect(e).toBeInstanceOf(NovaIDNotFoundError);
        }
    });


    // it("Ship should error on missing graphics", async () => {
    //     np.data[NovaDataType.Ship].get("nova:131")
    //         .should.be.rejectedWith(NovaIDNotFoundError);
    // });

    it("Should parse Ship", async () => {
        // Should parse the right Pict for ships that don't have a pict but share their baseImage with another ship
        expect(s129.pict).toEqual(s128.pict);
        const noDesc = np.data[NovaDataType.Ship].get("nova:130");
        try {
            await noDesc;
            fail();
        } catch (e) {
            //expect(e).toBeInstanceOf(NovaIDNotFoundError);
            expect(e).toBeInstanceOf(Error);
            expect((e as Error).message).toEqual("No matching dësc for shïp of id nova:130");
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
        expect(s128.physics.speed).toEqual(12 * ShipSpeedConversionFactor);
        expect(s128.physics.acceleration).toEqual(11 * ShipAccelerationConversionFactor);
        expect(s128.physics.turnRate).toEqual(13 * ShipTurnRateConversionFactor);
        expect(s128.physics.mass).toEqual(5678);
        expect(s128.physics.freeMass).toEqual(4234);
        expect(s128.physics.inertialess).toEqual(true);
        // Flags 0x0004: fast jumping (150% of normal hyperspace speed).
        expect(s128.physics.jumpSpeedMult).toEqual(1.5);
        expect(s129.physics.jumpSpeedMult).toEqual(1);
        // Flags2 0x0020: can jump without slowing down.
        expect(s128.physics.canJumpWithoutSlowing).toEqual(false);
        expect(s128.physics.jumpDistanceMod).toEqual(0);
        // The ship's DispWeight (its display order in the shipyard grid)
        // from the shïp resource's displayOrder field, not its id — the
        // grid orders by this, and the Flags3 0x4000 rule compares it.
        expect(s128.displayWeight).toEqual(3);
        // The shipyard gates parsed from the raw shïp resource:
        // Availability NCB, BuyRandom, and the Flags3 0x0100/0x0200/
        // 0x4000 bits (see shipyard_stock_rules.ts). The fixture's
        // flags3 is 0x361: 0x0100 + 0x0200 set, 0x4000 clear.
        // The fixture's nova:128 is WRITTEN by the "ship" plug-in and b13
        // is not in the (empty) stock base set, so it is that plug-in's
        // private bit, renumbered into the private range (ncb_namespace.ts:
        // ship's bits 1,2,3,4 from OnPurchase come first, then 13).
        expect(s128.availability).toEqual("b20004");
        expect(s128.buyRandom).toEqual(4);
        expect(s128.hideIfAvailabilityFalse).toEqual(true);
        expect(s128.hideIfRequireUnmet).toEqual(true);
        expect(s128.excludeEqualDisplayWeight).toEqual(false);
        expect(s128.deathDelay).toEqual(67 / 30);
        // largeExplosion is DeathDelay >= 60 FRAMES (67 here), the Bible's
        // "huge explosion ... proportional to the ship's mass" branch —
        // not the Explode2 + 1000 sparks flag, which is
        // finalExplosionSparks (see the spec further down).
        expect(s128.largeExplosion).toEqual(true);
        expect(s129.largeExplosion).toEqual(false);
    });

    it("Converts ship speed and acceleration to pixels per second", async () => {
        // The original engine ran physics at 30fps and stored speed as
        // pixels/frame * 100 (EVN Bible: weapon "Speed" is "pixels per
        // frame * 100"; particle velocity "a value of 100 is one pixel
        // per frame"). Ship Top Speed and Acceleration share that
        // encoding, so px/s = field * 30 / 100 = field * 0.3.
        //
        // The MovementSystem integrates velocity as px/s (it multiplies
        // by time.delta_s in seconds), so the parsed values must be px/s.
        const s128 = await np.data[NovaDataType.Ship].get("nova:128");

        // An "average" ship (Top Speed field 300) should move 90 px/s,
        // not 300 px/s. Before the fix the field passed through raw,
        // making every ship 100/30 ~= 3.33x too fast.
        expect(300 * ShipSpeedConversionFactor).toEqual(90);
        expect(300 * ShipAccelerationConversionFactor).toEqual(90);

        // The contrived fixture ship has raw speed 12 and acceleration 11.
        expect(s128.physics.speed).toEqual(12 * 0.3);
        expect(s128.physics.acceleration).toEqual(11 * 0.3);
    });

    it("Should parse the right pict ID for ships with the same baseImage", async () => {
        // Ships with the same baseImage as a previous ship that don't have a pictID defined for them get
        // the same pictID as the previous ship's

        const s200 = await np.data[NovaDataType.Ship].get("nova:200");
        // Even though it shares baseImage with s1, it should use its own pict.
        expect(s200.pict).toEqual("nova:5072");
    });

    it("Should parse animations for ships", async () => {
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

    it("Should parse which explosion a ship has", async () => {
        expect(s128.initialExplosion!).toEqual("nova:168");
        expect(s128.finalExplosion!).toEqual("nova:169");
        expect(s129.initialExplosion!).toEqual("nova:132");
        expect(s129.finalExplosion!).toEqual("nova:133");
    });

    it("drops Explode2 sparks when the id space has no bööm 128", async () => {
        // The fixture's shïp 128 sets Explode2 = 1041, so its raw
        // finalExplosionSparks is true (ship_resource_test) — but this
        // fixture filesystem defines no bööm 128, and the sparks are a
        // garnish on a fireball the ship shows anyway. So they resolve to
        // null WITHOUT the strict notFoundFunction firing: parsing the
        // ship must still succeed, and its own final explosion is intact.
        expect(s128.finalExplosionSparks).toBeNull();
        expect(s128.finalExplosion!).toEqual("nova:169");
        // shïp 129's Explode2 is a plain 5, so no sparks either way.
        expect(s129.finalExplosionSparks).toBeNull();
    });

    it("Should parse explosions", async () => {
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

    it("Should parse ship outfits including weapons", async () => {
        expect(s128.outfits).toEqual({
            "nova:150": 26,
            "nova:151": 38,
            "nova:130": 50,
            "nova:131": 58
        });
    });

    it("Should parse outfit physics", async () => {
        const o131: OutfitData = await np.data.Outfit.get("nova:131");
        expect(o131.physics).toEqual({
            freeMass: 73,
            freeCargo: 123,
            shield: 55,
            armor: 45,
            energyRecharge: FPS / 100
        });
    });

    it("Should plumb per-type jamming strength into OutfitData", async () => {
        // The fixture outfits carry no jamming ModTypes, so they should parse
        // to all-zero strengths. This exercises the plumbing (field present and
        // correctly shaped) without depending on stock jammer outfits.
        const o131: OutfitData = await np.data.Outfit.get("nova:131");
        expect(o131.jamming).toEqual([0, 0, 0, 0]);
    });

    it("Should plumb jam vulnerabilities and seeker flags into ProjectileWeaponData", async () => {
        const w132: WeaponData = await np.data.Weapon.get("nova:132");
        if (w132.type !== "ProjectileWeaponData") {
            fail("Expected w132 to be a projectile weapon");
            return;
        }
        // w132 is unguided in the fixture, so it carries no jamming
        // vulnerabilities; the important thing here is that the fields exist
        // and are shaped correctly (four clamped percentages + decoded flags).
        expect(w132.jamVulnerabilities.length).toEqual(4);
        for (const v of w132.jamVulnerabilities) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(100);
        }
        expect(w132.seeker).toEqual({
            passOverAsteroids: jasmine.any(Boolean),
            decoyedByAsteroids: jasmine.any(Boolean),
            confusedByInterference: jasmine.any(Boolean),
            turnsAwayIfJammed: jasmine.any(Boolean),
            attackParentIfJammed: jasmine.any(Boolean),
        });
    });

    it("Should parse projectileWeapon", async () => {
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
                blink: null,
                animationMode: null,
                weapDecay: 0,
                id: w132.id,
                name: w132.name,
                prefix: w132.prefix,
                writerPrefix: w132.writerPrefix,
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

    it("Should parse ammoType", async () => {
        const w132: WeaponData = await np.data.Weapon.get("nova:132");
        // AmmoType -1 doesn't use ammo.
        expect(w132.ammoType).toEqual("unlimited");

        // AmmoType -1540 consumes abs(-1540 + 1000) / 10 units of fuel
        // per shot.
        const w133: WeaponData = await np.data.Weapon.get("nova:133");
        expect(w133.ammoType).toEqual(["energy", 54]);
    });

    it("Should parse beamWeapon", async () => {
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
                width: 20,
                lightningDensity: 28,
                lightningAmplitude: 29,
            });
        }
    });

    it("Should plumb the closest-exit-point flag into WeaponData", async () => {
        // wëap Flags3 0x0010: "Weapon fires from whatever weapon exit
        // point is closest to the target" (the stock Ion Cannons). The
        // firing code needs it on WeaponData, not just on the raw
        // resource, to pick the exit point — so it must reach BOTH
        // weapon shapes, not only projectiles. Neither fixture weapon
        // sets the flag; the bit itself is covered by
        // weap_resource_test, and the true case on real stock data by
        // nova's weapon_exit_point_integration_test.
        const projectile = await np.data.Weapon.get("nova:132");
        const beam = await np.data.Weapon.get("nova:133");
        expect(projectile.firesFromClosestToTarget).toBeFalse();
        expect(beam.firesFromClosestToTarget).toBeFalse();
    });

    it("Should parse PictImage", async () => {
        const p700: PictImageData = await np.data.PictImage.get("nova:700");
        const statusBarPath = resolveFixture("resource_examples/picts/statusBar.png");
        const statusBar = await getPNG(statusBarPath);

        expect(p700).toEqual(PNG.sync.write(statusBar).buffer as ArrayBuffer);
    });

    it("Should parse Planet", async () => {
        const p128: PlanetData = await np.data.Planet.get("nova:128");
        expect(p128.landingDesc).toEqual("Hello. I'm a planet!");
        expect(p128.landingPict).toEqual("nova:10003");
    });

    it("Should parse SpriteSheetImage", async () => {
        const ri1000: SpriteSheetImageData = await np.data.SpriteSheetImage.get("nova:1000");
        const shuttlePath = resolveFixture("testSpriteSheetImage.png");
        const shuttle = fs.readFileSync(shuttlePath);
        expect(ri1000).toEqual(shuttle.buffer);
    });

    it("Should parse SpriteSheetFrames", async () => {
        const rf1116: SpriteSheetFramesData =
            await np.data.SpriteSheetFrames.get("nova:1116");

        const frames1116Path = resolveFixture("zephyrFrames.json");
        const shouldEqual1116 = JSON.parse(fs.readFileSync(
            frames1116Path, "utf8")) as SpriteSheetFramesData;
        expect(rf1116).toEqual(shouldEqual1116);

        const rf1000: SpriteSheetFramesData =
            await np.data.SpriteSheetFrames.get("nova:1000");

        const frames1000Path =
            resolveFixture("testSpriteSheetFrames.json");
        const shouldEqual1000 = JSON.parse(fs.readFileSync(
            frames1000Path, "utf8")) as SpriteSheetFramesData;
        expect(rf1000).toEqual(shouldEqual1000);
    });

    it("Should parse SpriteSheet", async () => {
        const rs1000: SpriteSheetData = await np.data.SpriteSheet.get("nova:1000");
        const sheet1000Path =
            resolveFixture("testSpriteSheet.json");
        const expectedSpriteSheet = JSON.parse(fs.readFileSync(
            sheet1000Path, "utf8")) as SpriteSheetData;

        var noNegativeZeroes = JSON.parse(JSON.stringify(rs1000)) as SpriteSheetData;
        expect(noNegativeZeroes).toEqual(expectedSpriteSheet);
    });

    it("Should produce the default StatusBar", async () => {
        const sb128 = await np.data.StatusBar.get("nova:128");
        expect(sb128.colors).toEqual(getDefaultStatusBarColors());
        expect(sb128.dataAreas).toEqual(getDefaultStatusBarDataAreas());
        expect(sb128.image).toEqual("nova:700");
        expect(sb128.fontSize).toEqual(12);
        expect(sb128.subtitleSize).toEqual(10);
    });

    it("Should parse ids", async () => {
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

    it("Should parse system planets", async () => {
        const s128 = await np.data.System.get("nova:128");
        expect(s128.planets).toEqual(['nova:128', 'nova:189', 'nova:194']);
    });

    it("Should plumb murk, interference, and background color into SystemData", async () => {
        const s128 = await np.data.System.get("nova:128");
        // The test fixture's system 128 is a plain system with none of these
        // hazard fields set; they must still be present and default to zero.
        expect(s128.murk).toBe(0);
        expect(s128.interference).toBe(0);
        expect(s128.backgroundColor).toBe(0);
    });

    it("Should parse planet position", async () => {
        const p194 = await np.data.Planet.get("nova:194");
        expect(p194.position).toEqual([22, -56]);
    });

    it("Should load Plug-ins in alphabetical order, last name winning", async () => {
        // "Loaded Before.ndat" and "Loaded Last.ndat" both define dësc
        // 13074 (shïp 202's description); the later name must win.
        const s201 = await np.data.Ship.get("nova:202");
        expect(s201.desc).toEqual("This should overwrite the Loaded Before plug-in");
    });

    it("Should defer throwing of errors to when specific resources are requested", async () => {
        const brokenNovaParse = new NovaParse("./not/a/real/path/");
        const data = brokenNovaParse.data;

        await expectAsync(data[NovaDataType.Ship].get("nova:128")).toBeRejected();
        await expectAsync(data[NovaDataType.Outfit].get("nova:128")).toBeRejected();
        await expectAsync(data[NovaDataType.Planet].get("nova:128")).toBeRejected();
    });

    it('Parses sound', async () => {
        const s300 = await np.data.SoundFile.get('nova:300');
        expect(s300.byteLength).toBeGreaterThan(0);
    });
});
