import "jasmine";
import { readResourceFork, Resource, ResourceMap } from "resource_fork";
import { WeapResource } from "../../src/resource_parsers/weap_resource.js";
import { WeaponParse } from "../../src/parsers/weapon_parse.js";
import { defaultIDSpace } from "./default_id_space.js";
import { ResourceBuilder } from "./resource_builder.js";

import { resolveFixture } from "../../test/fixtures.js";

describe("WeapResource", () => {
    // Weaps don't depend on other resources.
    const idSpace = defaultIDSpace;

    let rf: ResourceMap;
    let unguided: WeapResource;
    let beam: WeapResource;
    let beamTurret: WeapResource;
    let missile: WeapResource;
    let turret: WeapResource;
    let nosubs: WeapResource;

    beforeEach(async () => {
        const dataPath = resolveFixture("resource_examples/weap.ndat");
        rf = await readResourceFork(dataPath, false);

        const weaps = rf.wëap;
        unguided = new WeapResource(weaps[128], idSpace);
        beam = new WeapResource(weaps[129], idSpace);
        missile = new WeapResource(weaps[130], idSpace);
        turret = new WeapResource(weaps[131], idSpace);
        beamTurret = new WeapResource(weaps[132], idSpace);
        nosubs = new WeapResource(weaps[264], idSpace);
    });

    it("should parse shield damage", () => {
        expect(unguided.shieldDamage).toEqual(11);
        expect(beam.shieldDamage).toEqual(111);
        expect(missile.shieldDamage).toEqual(1);
        expect(turret.shieldDamage).toEqual(32767);
    });

    it("should parse armor damage", () => {
        expect(unguided.armorDamage).toEqual(12);
        expect(beam.armorDamage).toEqual(112);
        expect(missile.armorDamage).toEqual(2);
        expect(turret.armorDamage).toEqual(32767);
    });

    it("should parse impact", () => {
        expect(unguided.impact).toEqual(13);
        expect(beam.impact).toEqual(113);
        expect(missile.impact).toEqual(3);
        expect(turret.impact).toEqual(32767);
    });

    it("should parse decay", () => {
        expect(unguided.decay).toEqual(15);
        expect(beam.decay).toEqual(115);
        expect(missile.decay).toEqual(5);
        expect(turret.decay).toEqual(32767);
    });

    it("should parse reload time", () => {
        expect(unguided.reload).toEqual(16);
        expect(beam.reload).toEqual(116);
        expect(missile.reload).toEqual(6);
        expect(turret.reload).toEqual(32767);
    });

    it("should parse shot speed", () => {
        expect(unguided.speed).toEqual(17);
        expect(beam.speed).toEqual(117);
        expect(missile.speed).toEqual(7);
        expect(turret.speed).toEqual(32767);
    });

    it("should parse duration", () => {
        expect(unguided.duration).toEqual(18);
        expect(beam.duration).toEqual(118);
        expect(missile.duration).toEqual(8);
        expect(turret.duration).toEqual(32767);
    });

    it("should parse guidance", () => {
        expect(unguided.guidance).toEqual("unguided");
        expect(beam.guidance).toEqual("beam");
        expect(missile.guidance).toEqual("guided");
        expect(turret.guidance).toEqual("turret");
        expect(beamTurret.guidance).toEqual("beamTurret");
    });

    it("should parse turn rate", () => {
        expect(missile.turnRate).toEqual(9);
    });

    it("should parse accuracy", () => {
        expect(unguided.accuracy).toEqual(19);
        expect(beam.accuracy).toEqual(0);
        expect(missile.accuracy).toEqual(10);
        expect(turret.accuracy).toEqual(360);
    });

    it("should parse fireAtFixedAngle", () => {
        expect(unguided.firesAtFixedAngle).toEqual(false);
        expect(beam.firesAtFixedAngle).toEqual(false);
        expect(missile.firesAtFixedAngle).toEqual(true);
        expect(turret.firesAtFixedAngle).toEqual(false);

    });

    it("should parse AmmoType", () => {
        expect(unguided.ammoType).toEqual(-1);
        // uses 54 fuel per shot
        expect(beam.ammoType).toEqual(-1540);
        expect(missile.ammoType).toEqual(2);
        expect(turret.ammoType).toEqual(255);
    });

    it("should parse graphic", () => {
        expect(unguided.graphic).toEqual(3255);
        expect(beam.graphic).toEqual(null);
        expect(missile.graphic).toEqual(3244);
        expect(turret.graphic).toEqual(3001);
    });

    it("should parse sound", () => {
        expect(unguided.sound).toEqual(221);
        expect(beam.sound).toEqual(null);
        expect(missile.sound).toEqual(212);
        expect(turret.sound).toEqual(263);
    });

    it("should parse explosion", () => {
        expect(unguided.explosion).toEqual(147);
        expect(beam.explosion).toEqual(null);
        expect(missile.explosion).toEqual(138);
        expect(turret.explosion).toEqual(191);
    });

    it("should parse explosion128sparks", () => {
        expect(unguided.explosion128sparks).toEqual(false);
        //assert.equal(beam.explosion128sparks, -1);
        expect(missile.explosion128sparks).toEqual(true);
        expect(turret.explosion128sparks).toEqual(true);

    });

    it("should parse proxRadius", () => {
        expect(unguided.proxRadius).toEqual(49);
        //assert.equal(beam.proxRadius, 0);
        expect(missile.proxRadius).toEqual(40);
        expect(turret.proxRadius).toEqual(32767);
    });

    it("should parse blastRadius", () => {
        expect(unguided.blastRadius).toEqual(48);
        //assert.equal(beam.blastRadius, 0);
        expect(missile.blastRadius).toEqual(39);
        expect(turret.blastRadius).toEqual(32767);
    });

    it("should parse spinShots", () => {
        expect(unguided.spinShots).toEqual(false);
        //assert.equal(beam.spinShots, 0);
        expect(missile.spinShots).toEqual(true);
        expect(turret.spinShots).toEqual(true);
    });

    // see nova bible beamWidth
    it("should parse spinRate", () => {
        expect(missile.spinRate).toEqual(123);
        expect(turret.spinRate).toEqual(221);
    });

    it("should parse primary/secondary", () => {
        expect(unguided.fireGroup).toEqual("primary");
        expect(beam.fireGroup).toEqual("primary");
        expect(missile.fireGroup).toEqual("secondary");
        expect(turret.fireGroup).toEqual("primary");
    });


    it("should parse startSpinningOnFirstFrame", () => {
        //assert.equal(unguided.startSpinningOnFirstFrame, false);
        //assert.equal(beam.startSpinningOnFirstFrame, 0);
        expect(missile.startSpinningOnFirstFrame).toEqual(true);
        expect(turret.startSpinningOnFirstFrame).toEqual(false);
    });

    it("should parse dontFireAtFastShips", () => {
        expect(missile.dontFireAtFastShips).toEqual(true);
    });

    it("should parse loopSound", () => {
        expect(unguided.loopSound).toEqual(false);
        //assert.equal(beam.loopSound, "primary");
        expect(missile.loopSound).toEqual(true);
        expect(turret.loopSound).toEqual(false);
    });


    // these next tests need more test cases
    it("should parse passThroughShields", () => {
        expect(unguided.passThroughShields).toEqual(false);
        expect(beam.passThroughShields).toEqual(true);
        expect(missile.passThroughShields).toEqual(false);
        expect(turret.passThroughShields).toEqual(true);
    });

    it("should parse fireSimultaneously", () => {
        expect(unguided.fireSimultaneously).toEqual(false);
        expect(beam.fireSimultaneously).toEqual(true);
        expect(missile.fireSimultaneously).toEqual(false);
        expect(turret.fireSimultaneously).toEqual(true);
    });

    it("should parse vulnerableToPD", () => {
        expect(missile.vulnerableToPD).toEqual(true);
    });

    it("should parse hitsFiringShip", () => {
        expect(unguided.hitsFiringShip).toEqual(true);
        //assert.equal(beam.hitsFiringShip, true);
        expect(missile.hitsFiringShip).toEqual(false);
        expect(turret.hitsFiringShip).toEqual(true);
    });

    it("should parse smallCicnSmoke", () => {
        expect(unguided.smallCicnSmoke).toEqual(false);
        //assert.equal(beam.smallCicnSmoke, false);
        expect(missile.smallCicnSmoke).toEqual(false);
        expect(turret.smallCicnSmoke).toEqual(true);
    });

    it("should parse bigCicnSmoke", () => {
        expect(unguided.bigCicnSmoke).toEqual(false);
        //assert.equal(beam.bigCicnSmoke, false);
        expect(missile.bigCicnSmoke).toEqual(true);
        expect(turret.bigCicnSmoke).toEqual(false);
    });

    it("should parse persistentCicnSmoke", () => {
        expect(unguided.persistentCicnSmoke).toEqual(false);
        //assert.equal(beam.persistentCicnSmoke, false);
        expect(missile.persistentCicnSmoke).toEqual(false);
        expect(turret.persistentCicnSmoke).toEqual(true);
    });

    it("should parse turretBlindSpots", () => {
        var blindSpots = turret.turretBlindSpots;
        expect(blindSpots.front).toEqual(false);
        expect(blindSpots.side).toEqual(true);
        expect(blindSpots.back).toEqual(false);
    });

    it("should parse flak", () => {
        expect(unguided.flak).toEqual(false);
        //assert.equal(beam.flak, false);
        expect(missile.flak).toEqual(true);
        expect(turret.flak).toEqual(false);
    });

    it("should parse passOverAsteroids", () => {
        expect(unguided.passOverAsteroids).toEqual(false);
        expect(beam.passOverAsteroids).toEqual(false);
        expect(missile.passOverAsteroids).toEqual(true);
        expect(turret.passOverAsteroids).toEqual(true);
    });

    it("should parse decoyedByAsteroids", () => {
        //assert.equal(unguided.decoyedByAsteroids, false);
        //assert.equal(beam.decoyedByAsteroids, false);
        expect(missile.decoyedByAsteroids).toEqual(true);
        //assert.equal(turret.decoyedByAsteroids, false);
    });

    it("should parse confusedByInterference", () => {
        expect(missile.confusedByInterference).toEqual(true);
    });

    it("should parse turnsAwayIfJammed", () => {
        expect(missile.turnsAwayIfJammed).toEqual(true);
    });

    it("should parse cantFireWhileIonized", () => {
        expect(unguided.cantFireWhileIonized).toEqual(false);
        expect(beam.cantFireWhileIonized).toEqual(true);
        expect(missile.cantFireWhileIonized).toEqual(true);
        expect(turret.cantFireWhileIonized).toEqual(false);
    });

    it("should parse loseLockIfNotAhead", () => {
        expect(missile.loseLockIfNotAhead).toEqual(true);
    });

    it("should parse attackParentIfJammed", () => {
        expect(missile.attackParentIfJammed).toEqual(true);
    });

    // TODO: Parse CICNs correctly
    // it("should parse cicnSmoke", () => {
    //     console.log(unguided.data.getInt16(32) * 8);
    //     assert.equal(unguided.cicnSmoke, null);
    //     assert.equal(beam.cicnSmoke, null);

    //     var missileCicns = [1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007];
    //     var turretCicns = [1008, 1009, 1010, 1011, 1012, 1013, 1014, 1015];

    //     expect(missile.cicnSmoke).to.deep.equal(missileCicns);
    //     expect(turret.cicnSmoke).to.deep.equal(turretCicns);

    // });

    it("should parse decay", () => {
        expect(unguided.decay).toEqual(15);
        expect(beam.decay).toEqual(115);
        expect(missile.decay).toEqual(5);
        expect(turret.decay).toEqual(32767);
    });

    // The fixture beam carries -1 in the particle bytes; those are filler
    // in the beam variant of the template (keyed union on Weapon Type), so
    // the parser reads them as "no particles" rather than as -1 particles.
    it("should parse trailParticles number", () => {
        expect(unguided.trailParticles.count).toEqual(34);
        expect(beam.trailParticles.count).toEqual(0);
        expect(missile.trailParticles.count).toEqual(25);
        expect(turret.trailParticles.count).toEqual(32767);
    });

    it("should parse trailParticles lifeMin", () => {
        expect(unguided.trailParticles.lifeMin).toEqual(35);
        expect(beam.trailParticles.lifeMin).toEqual(0);
        expect(missile.trailParticles.lifeMin).toEqual(26);
        expect(turret.trailParticles.lifeMin).toEqual(32767);
    });

    it("should parse trailParticles lifeMax", () => {
        expect(unguided.trailParticles.lifeMax).toEqual(40);
        expect(beam.trailParticles.lifeMax).toEqual(0);
        expect(missile.trailParticles.lifeMax).toEqual(31);
        expect(turret.trailParticles.lifeMax).toEqual(32767);
    });


    it("should parse trailParticles color", () => {
        expect(unguided.trailParticles.color).toEqual(0x242526);
        expect(beam.trailParticles.color).toEqual(0x000000);
        expect(missile.trailParticles.color).toEqual(0x1B1C1D);
        expect(turret.trailParticles.color).toEqual(0xFFFFFF);
    });

    it("should parse beamLength", () => {
        expect(beam.beamLength).toEqual(19);
    });

    it("should parse beamWidth", () => {
        expect(beam.beamWidth).toEqual(20);
    });

    it("should parse coronaFalloff", () => {
        expect(beam.coronaFalloff).toEqual(24);
    });

    it("should parse beamColor", () => {
        expect(beam.beamColor).toEqual(0xFF151617);
    });

    it("should parse coronaColor", () => {
        expect(beam.coronaColor).toEqual(0xFF191A1B);
    });

    it("should parse submunitions count", () => {
        expect(unguided.submunition!.count).toEqual(25);
        expect(missile.submunition!.count).toEqual(16);
        expect(turret.submunition!.count).toEqual(32767);
    });

    it("should parse submunitions type", () => {
        expect(unguided.submunition!.id).toEqual(226);
        expect(beam.submunition).toBeNull();
        expect(missile.submunition!.id).toEqual(217);
        expect(turret.submunition!.id).toEqual(130);
    });

    it("should parse submunitions theta", () => {
        expect(unguided.submunition!.theta).toEqual(27);
        expect(missile.submunition!.theta).toEqual(-18);
        expect(turret.submunition!.theta).toEqual(32767);
    });

    it("should parse submunitions limit", () => {
        expect(unguided.submunition!.limit).toEqual(28);
        expect(missile.submunition!.limit).toEqual(19);
        expect(turret.submunition!.limit).toEqual(32767);
    });

    it("should not include subs if the sub id is 0", () => {
        expect(nosubs.submunition).toBeNull();
    });

    it("should parse proxSafety", () => {
        expect(unguided.proxSafety).toEqual(50);
        expect(missile.proxSafety).toEqual(41);
        expect(turret.proxSafety).toEqual(32767);
    });

    it("should parse spinBeforeProxSafety", () => {
        expect(unguided.spinBeforeProxSafety).toEqual(true);
        expect(missile.spinBeforeProxSafety).toEqual(false);
        expect(turret.spinBeforeProxSafety).toEqual(true);
    });

    it("should parse spinStopOnLastFrame", () => {
        expect(unguided.spinStopOnLastFrame).toEqual(false);
        expect(missile.spinStopOnLastFrame).toEqual(true);
        expect(turret.spinStopOnLastFrame).toEqual(true);
    });

    it("should parse proxIgnoreAsteroids", () => {
        expect(unguided.proxIgnoreAsteroids).toEqual(false);
        expect(beam.proxIgnoreAsteroids).toEqual(false);
        expect(missile.proxIgnoreAsteroids).toEqual(false);
        expect(turret.proxIgnoreAsteroids).toEqual(true);
    });

    it("should parse proxHitAll", () => {
        // true by default for all but guided type
        expect(unguided.proxHitAll).toEqual(true);
        expect(beam.proxHitAll).toEqual(true);
        expect(missile.proxHitAll).toEqual(false);
        expect(turret.proxHitAll).toEqual(true);
    });

    it("should parse submunitions fireAtNearest", () => {
        expect(unguided.submunition!.fireAtNearest).toEqual(false);
        expect(missile.submunition!.fireAtNearest).toEqual(true);
        expect(turret.submunition!.fireAtNearest).toEqual(false);
    });

    it("should parse submunitions subIfExpire", () => {
        expect(unguided.submunition!.subIfExpire).toEqual(true);
        expect(missile.submunition!.subIfExpire).toEqual(true);
        expect(turret.submunition!.subIfExpire).toEqual(false);
    });

    it("should parse showAmmo", () => {
        expect(unguided.showAmmo).toEqual(true);
        expect(beam.showAmmo).toEqual(false);
        expect(missile.showAmmo).toEqual(false);
        expect(turret.showAmmo).toEqual(true);
    });

    it("should parse fireOnlyIfKeyCarried", () => {
        expect(unguided.fireOnlyIfKeyCarried).toEqual(false);
        expect(beam.fireOnlyIfKeyCarried).toEqual(true);
        expect(missile.fireOnlyIfKeyCarried).toEqual(false);
        expect(turret.fireOnlyIfKeyCarried).toEqual(true);
    });
    it("should parse npcCantUse", () => {
        expect(unguided.npcCantUse).toEqual(false);
        expect(beam.npcCantUse).toEqual(true);
        expect(missile.npcCantUse).toEqual(false);
        expect(turret.npcCantUse).toEqual(true);
    });

    it("should parse useFiringAnimation", () => {
        expect(unguided.useFiringAnimation).toEqual(false);
        expect(beam.useFiringAnimation).toEqual(false);
        expect(missile.useFiringAnimation).toEqual(true);
        expect(turret.useFiringAnimation).toEqual(true);
    });

    it("should parse planetType", () => {
        expect(unguided.planetType).toEqual(false);
        expect(beam.planetType).toEqual(true);
        expect(missile.planetType).toEqual(true);
        expect(turret.planetType).toEqual(false);
    });

    it("should parse hideIfNoAmmo", () => {
        expect(unguided.hideIfNoAmmo).toEqual(false);
        expect(beam.hideIfNoAmmo).toEqual(false);
        expect(missile.hideIfNoAmmo).toEqual(true);
        expect(turret.hideIfNoAmmo).toEqual(true);
    });

    it("should parse disableOnly", () => {
        expect(unguided.disableOnly).toEqual(false);
        expect(beam.disableOnly).toEqual(true);
        expect(missile.disableOnly).toEqual(true);
        expect(turret.disableOnly).toEqual(false);
    });

    it("should parse beamUnderShip", () => {
        expect(unguided.beamUnderShip).toEqual(false);
        expect(beam.beamUnderShip).toEqual(true);
        expect(missile.beamUnderShip).toEqual(false);
        expect(turret.beamUnderShip).toEqual(false);
    });

    it("should parse fireWhileCloaked", () => {
        expect(unguided.fireWhileCloaked).toEqual(false);
        expect(beam.fireWhileCloaked).toEqual(true);
        expect(missile.fireWhileCloaked).toEqual(true);
        expect(turret.fireWhileCloaked).toEqual(false);
    });

    it("should parse asteroidMiner", () => {
        expect(unguided.asteroidMiner).toEqual(false);
        expect(beam.asteroidMiner).toEqual(true);
        expect(missile.asteroidMiner).toEqual(false);
        expect(turret.asteroidMiner).toEqual(true);
    });

    it("should parse ionization", () => {
        expect(unguided.ionization).toEqual(29);
        expect(beam.ionization).toEqual(0);
        expect(missile.ionization).toEqual(20);
        expect(turret.ionization).toEqual(32767);
    });

    it("should parse hitParticles number", () => {
        expect(unguided.hitParticles.count).toEqual(41);
        expect(beam.hitParticles.count).toEqual(-1);
        expect(missile.hitParticles.count).toEqual(32);
        expect(turret.hitParticles.count).toEqual(32767);
    });

    it("should parse hitParticles life", () => {
        expect(unguided.hitParticles.lifeMin).toEqual(43);
        expect(unguided.hitParticles.lifeMax).toEqual(43);
        expect(beam.hitParticles.lifeMin).toEqual(-1);
        expect(beam.hitParticles.lifeMax).toEqual(-1);
        expect(missile.hitParticles.lifeMin).toEqual(34);
        expect(missile.hitParticles.lifeMax).toEqual(34);
        expect(turret.hitParticles.lifeMin).toEqual(32767);
        expect(turret.hitParticles.lifeMax).toEqual(32767);
    });

    it("should parse hitParticles velocity", () => {
        expect(unguided.hitParticles.velocity).toEqual(42);
        expect(beam.hitParticles.velocity).toEqual(-1);
        expect(missile.hitParticles.velocity).toEqual(33);
        expect(turret.hitParticles.velocity).toEqual(32767);
    });

    it("should parse hitParticles color", () => {
        expect(unguided.hitParticles.color).toEqual(0x2C2D2E);
        expect(beam.hitParticles.color).toEqual(0x000000);
        expect(missile.hitParticles.color).toEqual(0x232425);
        expect(turret.hitParticles.color).toEqual(0xFFFFFF);
    });

    it("should parse exitType", () => {
        expect(unguided.exitType).toEqual("center");
        expect(beam.exitType).toEqual("gun");
        expect(missile.exitType).toEqual("turret");
        expect(turret.exitType).toEqual("guided");
        expect(beamTurret.exitType).toEqual("beam");
    });

    it("should parse burstCount", () => {
        expect(unguided.burstCount).toEqual(23);
        expect(beam.burstCount).toEqual(-1);
        expect(missile.burstCount).toEqual(14);
        expect(turret.burstCount).toEqual(32767);
    });

    it("should parse burstReload", () => {
        expect(unguided.burstReload).toEqual(24);
        expect(beam.burstReload).toEqual(-1);
        expect(missile.burstReload).toEqual(15);
        expect(turret.burstReload).toEqual(32767);
    });

    it("should parse jamVuln 1", () => {
        expect(missile.jamVuln[0]).toEqual(43);
    });

    it("should parse jamVuln 2", () => {
        expect(missile.jamVuln[1]).toEqual(44);
    });

    it("should parse jamVuln 3", () => {
        expect(missile.jamVuln[2]).toEqual(45);
    });

    it("should parse jamVuln 4", () => {
        expect(missile.jamVuln[3]).toEqual(46);
    });

    it("should parse oneAmmoPerBurst", () => {
        expect(unguided.oneAmmoPerBurst).toEqual(false);
        expect(beam.oneAmmoPerBurst).toEqual(true);
        expect(missile.oneAmmoPerBurst).toEqual(true);
        expect(turret.oneAmmoPerBurst).toEqual(false);
    });

    it("should parse translucent", () => {
        expect(unguided.translucent).toEqual(false);
        expect(beam.translucent).toEqual(false);
        expect(missile.translucent).toEqual(true);
        expect(turret.translucent).toEqual(true);
    });

    // Bible, wëap Flags3: "0x0010 Weapon fires from whatever weapon exit
    // point is closest to the target". In Nova's own data only the two
    // Ion Cannons (nova:142, nova:201) set it.
    it("should parse firesFromClosestToTarget", () => {
        expect(unguided.firesFromClosestToTarget).toEqual(false);
        expect(beam.firesFromClosestToTarget).toEqual(false);
        expect(missile.firesFromClosestToTarget).toEqual(true);
        expect(turret.firesFromClosestToTarget).toEqual(false);
    });

    // prevents other weaps from firing
    it("should parse exclusive", () => {
        expect(unguided.exclusive).toEqual(false);
        expect(beam.exclusive).toEqual(true);
        expect(missile.exclusive).toEqual(true);
        expect(turret.exclusive).toEqual(false);
    });

    it("should parse durability", () => {
        expect(unguided.durability).toEqual(0);
        expect(beam.durability).toEqual(0);
        expect(missile.durability).toEqual(42);
        expect(turret.durability).toEqual(0);
    });

    it("should parse turnRate", () => {
        expect(unguided.turnRate).toEqual(0);
        expect(beam.turnRate).toEqual(0);
        expect(missile.turnRate).toEqual(9);
        expect(turret.turnRate).toEqual(0);
    });

    it("should parse maxAmmo", () => {
        expect(unguided.maxAmmo).toEqual(22);
        expect(beam.maxAmmo).toEqual(-1);
        expect(missile.maxAmmo).toEqual(13);
        expect(turret.maxAmmo).toEqual(32767);
    });

    it("should parse maxAmmo", () => {
        expect(unguided.maxAmmo).toEqual(22);
        expect(beam.maxAmmo).toEqual(-1);
        expect(missile.maxAmmo).toEqual(13);
        expect(turret.maxAmmo).toEqual(32767);
    });

    it("should parse recoil", () => {
        expect(unguided.recoil).toEqual(14);
        expect(beam.recoil).toEqual(114);
        expect(missile.recoil).toEqual(4);
        expect(turret.recoil).toEqual(32767);
        expect(beamTurret.recoil).toEqual(0);
    });

    it("should parse lightningDensity", () => {
        expect(beam.lightningDensity).toEqual(28);
        expect(beamTurret.lightningDensity).toEqual(10);
    });

    it("should parse lightningAmplitude", () => {
        expect(beam.lightningAmplitude).toEqual(29);
        expect(beamTurret.lightningAmplitude).toEqual(15);
    });

    it("should parse ionizeColor", () => {
        expect(unguided.ionizeColor).toEqual(0xFF1E1F20);
        expect(beam.ionizeColor).toEqual(0xFF000000);
        expect(missile.ionizeColor).toEqual(0xFF151617);
        expect(turret.ionizeColor).toEqual(0xFFFFFFFF);
        expect(beamTurret.ionizeColor).toEqual(0xFFA55AA5);
    });
});

describe("WeapResource builder-based", () => {
    const idSpace = defaultIDSpace;

    /** A wëap with distinct, recognizable values in every field. */
    function buildWeap(): ResourceBuilder {
        const b = new ResourceBuilder();
        b.int16(16)                 // 0 reload
            .int16(18)              // 2 duration ("Count" in the Bible)
            .int16(12)              // 4 armorDamage
            .int16(11)              // 6 shieldDamage
            .int16(1)               // 8 guidance = guided
            .int16(17)              // 10 speed
            .int16(2)               // 12 ammoType
            .int16(255)             // 14 graphic -> 3255
            .int16(-19)             // 16 accuracy (negative => fixed angle)
            .int16(12)              // 18 sound -> 212
            .int16(13)              // 20 impact
            .int16(1010)            // 22 explosion -> sparks, base 138
            .int16(40)              // 24 proxRadius
            .int16(39)              // 26 blastRadius
            .uint16(0x0001)         // 28 flags: spinShots
            .int16(0x0002)          // 30 guidedFlags: decoyedByAsteroids
            .int16(1)               // 32 smoke set -> cicns 1008..1015
            .int16(5)               // 34 decay
            .int16(25)              // 36 trail count
            .int16(26)              // 38 trail velocity
            .int16(27)              // 40 trail lifeMin
            .int16(31)              // 42 trail lifeMax
            .uint32(0x00010203)     // 44 trail color
            .int16(19)              // 48 beamLength
            .int16(123)             // 50 beamWidth / spinRate
            .int16(24)              // 52 coronaFalloff
            .uint32(0x00151617)     // 54 beamColor
            .uint32(0x00191A1B)     // 58 coronaColor
            .int16(16)              // 62 subCount
            .int16(217)             // 64 subID
            .int16(-18)             // 66 subTheta
            .int16(19)              // 68 subLimit
            .int16(41)              // 70 proxSafety
            .uint16(0x0000)         // 72 flags2
            .int16(20)              // 74 ionization
            .int16(32)              // 76 hit count
            .int16(34)              // 78 hit life
            .int16(33)              // 80 hit velocity
            .uint32(0x00232425)     // 82 hit color
            .int16(4)               // 86 recoil
            .int16(1)               // 88 exitType -> turret
            .int16(14)              // 90 burstCount
            .int16(15)              // 92 burstReload
            .int16(43)              // 94 jam infrared
            .int16(44)              // 96 jam radar
            .int16(45)              // 98 jam ethericWake
            .int16(46)              // 100 jam gravametric
            .uint16(0x0002)         // 102 flags3: translucent
            .int16(42)              // 104 durability
            .int16(9)               // 106 turnRate (guidedTurn)
            .int16(13)              // 108 maxAmmo
            .int16(28)              // 110 lightningDensity
            .int16(29)              // 112 lightningAmplitude
            .uint32(0x00151617)     // 114 ionizeColor
            .skip(16);              // 118 unused
        return b;
    }

    it("builds a full-size resource matching Nova's data", () => {
        // Every wëap in Nova's own data (and every plug-in checked) is 134 bytes.
        expect(buildWeap().byteLength).toBe(134);
    });

    it("parses the extended trailing fields at the correct offsets", () => {
        const w = new WeapResource(buildWeap().resource("wëap", 128), idSpace);
        // These live past offset 100, well into the post-header region.
        expect(w.durability).toEqual(42);
        expect(w.turnRate).toEqual(9);
        expect(w.maxAmmo).toEqual(13);
        expect(w.lightningDensity).toEqual(28);
        expect(w.lightningAmplitude).toEqual(29);
        expect(w.ionizeColor).toEqual(0xFF151617);
    });

    it("treats an unknown guidance type as unguided with a warning", () => {
        // Guidance 2 is marked "(unused)" in the Bible but appears in some
        // community plug-ins.
        const dv = buildWeap().dataView();
        dv.setInt16(8, 2);
        const resource = new Resource("wëap", 200, "Weird", dv);
        const warnSpy = spyOn(console, "warn");
        const w = new WeapResource(resource, idSpace);
        expect(w.guidance).toEqual("unguided");
        expect(warnSpy).toHaveBeenCalled();
    });

    // The wëap template is a keyed union on Weapon Type: the beam and
    // carried-ship variants mark projectile-only ranges as filler, and
    // buildWeap fills every one of those ranges with a recognizable value.
    describe("keyed-union filler ranges", () => {
        function withGuidance(guidance: number, id: number): WeapResource {
            const dv = buildWeap().dataView();
            dv.setInt16(8, guidance);
            return new WeapResource(new Resource("wëap", id, "Keyed", dv), idSpace);
        }

        it("zeroes the projectile-only ranges of a beam (Radius, particles, subs)", () => {
            for (const guidance of [0, 3, 10]) {
                const w = withGuidance(guidance, 300 + guidance);
                expect(w.proxRadius).withContext(`guidance ${guidance}`).toEqual(0);
                expect(w.blastRadius).toEqual(0);
                expect(w.trailParticles).toEqual(
                    { count: 0, velocity: 0, lifeMin: 0, lifeMax: 0, color: 0 });
                expect(w.submunition).toBeNull();
                expect(w.proxSafety).toEqual(0);
                // The beam's own fields are untouched.
                expect(w.beamLength).toEqual(19);
                expect(w.beamWidth).toEqual(123);
                expect(w.coronaFalloff).toEqual(24);
                expect(w.beamColor).toEqual(0xFF151617);
                expect(w.impact).toEqual(13);
                expect(w.explosion).toEqual(138);
                expect(w.exitType).toEqual("turret");
                expect(w.ionization).toEqual(20);
                expect(w.hitParticles.count).toEqual(32);
            }
        });

        it("reads a carried-ship (bay) weapon by its own layout", () => {
            const w = withGuidance(99, 310);
            expect(w.guidance).toEqual("bay");
            // 88 is a filler word for bays: fighters launch from the centre.
            expect(w.exitType).toEqual("center");
            expect(w.exitTypeN).toEqual(-1);
            // 20-27, 32-71, 74-85 and 110-117 are filler too.
            expect(w.impact).toEqual(0);
            expect(w.explosion).toBeNull();
            expect(w.explosion128sparks).toBeFalse();
            expect(w.proxRadius).toEqual(0);
            expect(w.blastRadius).toEqual(0);
            expect(w.cicnSmoke).toBeNull();
            expect(w.decay).toEqual(0);
            expect(w.trailParticles.count).toEqual(0);
            expect(w.beamLength).toEqual(0);
            expect(w.spinRate).toEqual(0);
            expect(w.submunition).toBeNull();
            expect(w.ionization).toEqual(0);
            expect(w.hitParticles.count).toEqual(0);
            expect(w.lightningDensity).toEqual(0);
            expect(w.lightningAmplitude).toEqual(0);
            // The bay's real fields survive: Launch Speed, Ship Type,
            // flags, burst, jamming, durability and Max Ammo.
            expect(w.speed).toEqual(17);
            expect(w.ammoType).toEqual(2);
            expect(w.accuracy).toEqual(19);
            expect(w.sound).toEqual(212);
            expect(w.fireGroup).toEqual("primary");
            expect(w.burstCount).toEqual(14);
            expect(w.burstReload).toEqual(15);
            expect(w.jam.radar).toEqual(44);
            expect(w.durability).toEqual(42);
            expect(w.maxAmmo).toEqual(13);
        });

        it("leaves a projectile weapon's fields alone", () => {
            const w = withGuidance(-1, 320);
            expect(w.proxRadius).toEqual(40);
            expect(w.blastRadius).toEqual(39);
            expect(w.trailParticles.count).toEqual(25);
            expect(w.submunition?.id).toEqual(217);
            expect(w.exitType).toEqual("turret");
        });
    });

    it("parses the smoke set into eight consecutive cicn ids", () => {
        const dv = buildWeap().dataView();
        // Smoke set 2 -> cicns 1016..1023 (each set is 8 cicns from 1000).
        dv.setInt16(32, 2);
        const resource = new Resource("wëap", 201, "Smoky", dv);
        const w = new WeapResource(resource, idSpace);
        expect(w.cicnSmoke).toEqual(
            [1016, 1017, 1018, 1019, 1020, 1021, 1022, 1023]);
    });

    it("parses a smoke set of -1 as no smoke", () => {
        const dv = buildWeap().dataView();
        // Raw -1 means "no smoke"; it must not be scaled into a spurious
        // set of cicn ids (regression: -1 * 8 + 1000 = 992..999).
        dv.setInt16(32, -1);
        const resource = new Resource("wëap", 202, "Smokeless", dv);
        const w = new WeapResource(resource, idSpace);
        expect(w.cicnSmoke).toBeNull();
    });

    it("defaults gracefully when the resource is truncated", () => {
        // A resource cut off at offset 40 must not throw; missing trailing
        // fields fall back to their defaults.
        const resource = buildWeap().truncate(40).resource("wëap", 128);
        const w = new WeapResource(resource, idSpace);
        expect(w.reload).toEqual(16);
        expect(w.guidance).toEqual("guided");
        // Fields past the cut default to 0 / null.
        expect(w.beamLength).toEqual(0);
        expect(w.maxAmmo).toEqual(0);
        expect(w.submunition).toBeNull();
        expect(w.recoil).toEqual(0);
    });

    /**
     * Builds a guided (projectile) wëap with `coronaFalloff` at offset 52
     * overridden, stamped with a globalID/prefix (which IDSpaceHandler
     * would normally set) so WeaponParse can run. Missing graphic/sound/
     * explosion fall back gracefully via the no-op notFoundFunction.
     */
    async function parseProjectile(coronaFalloff: number) {
        const dv = buildWeap().dataView();
        dv.setInt16(52, coronaFalloff); // 52 coronaFalloff / sprite Falloff
        const resource = new Resource("wëap", 128, "Test Projectile", dv);
        const w = new WeapResource(resource, idSpace);
        w.globalID = "nova:128";
        w.prefix = "nova:";
        return WeaponParse(w, () => { });
    }

    it("plumbs the wëap Falloff (coronaFalloff byte) onto ProjectileWeaponData.falloff", async () => {
        // The same byte beams use for coronaFalloff is repurposed for
        // sprite fade per the Bible's Falloff sprite note. A Falloff of 2
        // (Fusion Pulse Cannon / railguns) comes through verbatim.
        const w = await parseProjectile(2);
        expect(w.type).toEqual("ProjectileWeaponData");
        if (w.type === "ProjectileWeaponData") {
            expect(w.falloff).toEqual(2);
        }
    });

    it("clamps a negative Falloff to 0 (no fade)", async () => {
        // The Bible's sprite range starts at 1; 0/negative means no fade.
        // Clamp so 0 is the "no fade" sentinel (mirrors the Decay clamp).
        const w = await parseProjectile(-3);
        expect(w.type).toEqual("ProjectileWeaponData");
        if (w.type === "ProjectileWeaponData") {
            expect(w.falloff).toEqual(0);
        }
    });
});
