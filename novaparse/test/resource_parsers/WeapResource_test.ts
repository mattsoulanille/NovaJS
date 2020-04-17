import "jasmine";
import { readResourceFork, ResourceMap } from "resourceforkjs";
import { WeapResource } from "../../src/resource_parsers/WeapResource";
import { defaultIDSpace } from "./DefaultIDSpace";


describe("WeapResource", function() {
    // Weaps don't depend on other resources.
    const idSpace = defaultIDSpace;

    let rf: ResourceMap;
    let unguided: WeapResource;
    let beam: WeapResource;
    let beamTurret: WeapResource;
    let missile: WeapResource;
    let turret: WeapResource;
    let nosubs: WeapResource;

    beforeEach(async function() {
        const dataPath = require.resolve("novajs/novaparse/test/resource_parsers/files/weap.ndat");
        rf = await readResourceFork(dataPath, false);

        const weaps = rf.wëap;
        unguided = new WeapResource(weaps[128], idSpace);
        beam = new WeapResource(weaps[129], idSpace);
        missile = new WeapResource(weaps[130], idSpace);
        turret = new WeapResource(weaps[131], idSpace);
        beamTurret = new WeapResource(weaps[132], idSpace);
        nosubs = new WeapResource(weaps[264], idSpace);
    });

    it("should parse shield damage", function() {
        expect(unguided.shieldDamage).toEqual(11);
        expect(beam.shieldDamage).toEqual(111);
        expect(missile.shieldDamage).toEqual(1);
        expect(turret.shieldDamage).toEqual(32767);
    });

    it("should parse armor damage", function() {
        expect(unguided.armorDamage).toEqual(12);
        expect(beam.armorDamage).toEqual(112);
        expect(missile.armorDamage).toEqual(2);
        expect(turret.armorDamage).toEqual(32767);
    });

    it("should parse impact", function() {
        expect(unguided.impact).toEqual(13);
        expect(beam.impact).toEqual(113);
        expect(missile.impact).toEqual(3);
        expect(turret.impact).toEqual(32767);
    });

    it("should parse decay", function() {
        expect(unguided.decay).toEqual(15);
        expect(beam.decay).toEqual(115);
        expect(missile.decay).toEqual(5);
        expect(turret.decay).toEqual(32767);
    });

    it("should parse reload time", function() {
        expect(unguided.reload).toEqual(16);
        expect(beam.reload).toEqual(116);
        expect(missile.reload).toEqual(6);
        expect(turret.reload).toEqual(32767);
    });

    it("should parse shot speed", function() {
        expect(unguided.speed).toEqual(17);
        expect(beam.speed).toEqual(117);
        expect(missile.speed).toEqual(7);
        expect(turret.speed).toEqual(32767);
    });

    it("should parse duration", function() {
        expect(unguided.duration).toEqual(18);
        expect(beam.duration).toEqual(118);
        expect(missile.duration).toEqual(8);
        expect(turret.duration).toEqual(32767);
    });

    it("should parse guidance", function() {
        expect(unguided.guidance).toEqual("unguided");
        expect(beam.guidance).toEqual("beam");
        expect(missile.guidance).toEqual("guided");
        expect(turret.guidance).toEqual("turret");
        expect(beamTurret.guidance).toEqual("beamTurret");
    });

    it("should parse turn rate", function() {
        expect(missile.turnRate).toEqual(9);
    });

    it("should parse accuracy", function() {
        expect(unguided.accuracy).toEqual(19);
        expect(beam.accuracy).toEqual(0);
        expect(missile.accuracy).toEqual(10);
        expect(turret.accuracy).toEqual(360);
    });

    it("should parse fireAtFixedAngle", function() {
        expect(unguided.firesAtFixedAngle).toEqual(false);
        expect(beam.firesAtFixedAngle).toEqual(false);
        expect(missile.firesAtFixedAngle).toEqual(true);
        expect(turret.firesAtFixedAngle).toEqual(false);

    });

    it("should parse AmmoType", function() {
        expect(unguided.ammoType).toEqual(-1);
        // uses 54 fuel per shot
        expect(beam.ammoType).toEqual(-1540);
        expect(missile.ammoType).toEqual(2);
        expect(turret.ammoType).toEqual(255);
    });

    it("should parse graphic", function() {
        expect(unguided.graphic).toEqual(3255);
        expect(beam.graphic).toEqual(null);
        expect(missile.graphic).toEqual(3244);
        expect(turret.graphic).toEqual(3001);
    });

    it("should parse sound", function() {
        expect(unguided.sound).toEqual(221);
        expect(beam.sound).toEqual(null);
        expect(missile.sound).toEqual(212);
        expect(turret.sound).toEqual(263);
    });

    it("should parse explosion", function() {
        expect(unguided.explosion).toEqual(147);
        expect(beam.explosion).toEqual(null);
        expect(missile.explosion).toEqual(138);
        expect(turret.explosion).toEqual(191);
    });

    it("should parse explosion128sparks", function() {
        expect(unguided.explosion128sparks).toEqual(false);
        //assert.equal(beam.explosion128sparks, -1);
        expect(missile.explosion128sparks).toEqual(true);
        expect(turret.explosion128sparks).toEqual(true);

    });

    it("should parse proxRadius", function() {
        expect(unguided.proxRadius).toEqual(49);
        //assert.equal(beam.proxRadius, 0);
        expect(missile.proxRadius).toEqual(40);
        expect(turret.proxRadius).toEqual(32767);
    });

    it("should parse blastRadius", function() {
        expect(unguided.blastRadius).toEqual(48);
        //assert.equal(beam.blastRadius, 0);
        expect(missile.blastRadius).toEqual(39);
        expect(turret.blastRadius).toEqual(32767);
    });

    it("should parse spinShots", function() {
        expect(unguided.spinShots).toEqual(false);
        //assert.equal(beam.spinShots, 0);
        expect(missile.spinShots).toEqual(true);
        expect(turret.spinShots).toEqual(true);
    });

    // see nova bible beamWidth
    it("should parse spinRate", function() {
        expect(missile.spinRate).toEqual(123);
        expect(turret.spinRate).toEqual(221);
    });

    it("should parse primary/secondary", function() {
        expect(unguided.fireGroup).toEqual("primary");
        expect(beam.fireGroup).toEqual("primary");
        expect(missile.fireGroup).toEqual("secondary");
        expect(turret.fireGroup).toEqual("primary");
    });


    it("should parse startSpinningOnFirstFrame", function() {
        //assert.equal(unguided.startSpinningOnFirstFrame, false);
        //assert.equal(beam.startSpinningOnFirstFrame, 0);
        expect(missile.startSpinningOnFirstFrame).toEqual(true);
        expect(turret.startSpinningOnFirstFrame).toEqual(false);
    });

    it("should parse dontFireAtFastShips", function() {
        expect(missile.dontFireAtFastShips).toEqual(true);
    });

    it("should parse loopSound", function() {
        expect(unguided.loopSound).toEqual(false);
        //assert.equal(beam.loopSound, "primary");
        expect(missile.loopSound).toEqual(true);
        expect(turret.loopSound).toEqual(false);
    });


    // these next tests need more test cases
    it("should parse passThroughShields", function() {
        expect(unguided.passThroughShields).toEqual(false);
        expect(beam.passThroughShields).toEqual(true);
        expect(missile.passThroughShields).toEqual(false);
        expect(turret.passThroughShields).toEqual(true);
    });

    it("should parse fireSimultaneously", function() {
        expect(unguided.fireSimultaneously).toEqual(false);
        expect(beam.fireSimultaneously).toEqual(true);
        expect(missile.fireSimultaneously).toEqual(false);
        expect(turret.fireSimultaneously).toEqual(true);
    });

    it("should parse vulnerableToPD", function() {
        expect(missile.vulnerableToPD).toEqual(true);
    });

    it("should parse hitsFiringShip", function() {
        expect(unguided.hitsFiringShip).toEqual(true);
        //assert.equal(beam.hitsFiringShip, true);
        expect(missile.hitsFiringShip).toEqual(false);
        expect(turret.hitsFiringShip).toEqual(true);
    });

    it("should parse smallCicnSmoke", function() {
        expect(unguided.smallCicnSmoke).toEqual(false);
        //assert.equal(beam.smallCicnSmoke, false);
        expect(missile.smallCicnSmoke).toEqual(false);
        expect(turret.smallCicnSmoke).toEqual(true);
    });

    it("should parse bigCicnSmoke", function() {
        expect(unguided.bigCicnSmoke).toEqual(false);
        //assert.equal(beam.bigCicnSmoke, false);
        expect(missile.bigCicnSmoke).toEqual(true);
        expect(turret.bigCicnSmoke).toEqual(false);
    });

    it("should parse persistentCicnSmoke", function() {
        expect(unguided.persistentCicnSmoke).toEqual(false);
        //assert.equal(beam.persistentCicnSmoke, false);
        expect(missile.persistentCicnSmoke).toEqual(false);
        expect(turret.persistentCicnSmoke).toEqual(true);
    });

    it("should parse turretBlindSpots", function() {
        var blindSpots = turret.turretBlindSpots;
        expect(blindSpots.front).toEqual(false);
        expect(blindSpots.side).toEqual(true);
        expect(blindSpots.back).toEqual(false);
    });

    it("should parse flak", function() {
        expect(unguided.flak).toEqual(false);
        //assert.equal(beam.flak, false);
        expect(missile.flak).toEqual(true);
        expect(turret.flak).toEqual(false);
    });

    it("should parse passOverAsteroids", function() {
        expect(unguided.passOverAsteroids).toEqual(false);
        expect(beam.passOverAsteroids).toEqual(false);
        expect(missile.passOverAsteroids).toEqual(true);
        expect(turret.passOverAsteroids).toEqual(true);
    });

    it("should parse decoyedByAsteroids", function() {
        //assert.equal(unguided.decoyedByAsteroids, false);
        //assert.equal(beam.decoyedByAsteroids, false);
        expect(missile.decoyedByAsteroids).toEqual(true);
        //assert.equal(turret.decoyedByAsteroids, false);
    });

    it("should parse confusedByInterference", function() {
        expect(missile.confusedByInterference).toEqual(true);
    });

    it("should parse turnsAwayIfJammed", function() {
        expect(missile.turnsAwayIfJammed).toEqual(true);
    });

    it("should parse cantFireWhileIonized", function() {
        expect(unguided.cantFireWhileIonized).toEqual(false);
        expect(beam.cantFireWhileIonized).toEqual(true);
        expect(missile.cantFireWhileIonized).toEqual(true);
        expect(turret.cantFireWhileIonized).toEqual(false);
    });

    it("should parse loseLockIfNotAhead", function() {
        expect(missile.loseLockIfNotAhead).toEqual(true);
    });

    it("should parse attackParentIfJammed", function() {
        expect(missile.attackParentIfJammed).toEqual(true);
    });

    // TODO: Parse CICNs correctly
    // it("should parse cicnSmoke", function() {
    //     console.log(unguided.data.getInt16(32) * 8);
    //     assert.equal(unguided.cicnSmoke, null);
    //     assert.equal(beam.cicnSmoke, null);

    //     var missileCicns = [1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007];
    //     var turretCicns = [1008, 1009, 1010, 1011, 1012, 1013, 1014, 1015];

    //     expect(missile.cicnSmoke).to.deep.equal(missileCicns);
    //     expect(turret.cicnSmoke).to.deep.equal(turretCicns);

    // });

    it("should parse decay", function() {
        expect(unguided.decay).toEqual(15);
        expect(beam.decay).toEqual(115);
        expect(missile.decay).toEqual(5);
        expect(turret.decay).toEqual(32767);
    });

    it("should parse trailParticles number", function() {
        expect(unguided.trailParticles.count).toEqual(34);
        expect(beam.trailParticles.count).toEqual(-1);
        expect(missile.trailParticles.count).toEqual(25);
        expect(turret.trailParticles.count).toEqual(32767);
    });

    it("should parse trailParticles lifeMin", function() {
        expect(unguided.trailParticles.lifeMin).toEqual(35);
        expect(beam.trailParticles.lifeMin).toEqual(-1);
        expect(missile.trailParticles.lifeMin).toEqual(26);
        expect(turret.trailParticles.lifeMin).toEqual(32767);
    });

    it("should parse trailParticles lifeMax", function() {
        expect(unguided.trailParticles.lifeMax).toEqual(40);
        expect(beam.trailParticles.lifeMax).toEqual(-1);
        expect(missile.trailParticles.lifeMax).toEqual(31);
        expect(turret.trailParticles.lifeMax).toEqual(32767);
    });


    it("should parse trailParticles color", function() {
        expect(unguided.trailParticles.color).toEqual(0xFF242526);
        expect(beam.trailParticles.color).toEqual(0xFF000000);
        expect(missile.trailParticles.color).toEqual(0xFF1B1C1D);
        expect(turret.trailParticles.color).toEqual(0xFFFFFFFF);
    });

    it("should parse beamLength", function() {
        expect(beam.beamLength).toEqual(19);
    });

    it("should parse beamWidth", function() {
        expect(beam.beamWidth).toEqual(20);
    });

    it("should parse coronaFalloff", function() {
        expect(beam.coronaFalloff).toEqual(24);
    });

    it("should parse beamColor", function() {
        expect(beam.beamColor).toEqual(0xFF151617);
    });

    it("should parse coronaColor", function() {
        expect(beam.coronaColor).toEqual(0xFF191A1B);
    });

    it("should parse submunitions count", function() {
        expect(unguided.submunition!.count).toEqual(25);
        expect(missile.submunition!.count).toEqual(16);
        expect(turret.submunition!.count).toEqual(32767);
    });

    it("should parse submunitions type", function() {
        expect(unguided.submunition!.id).toEqual(226);
        expect(beam.submunition).toBeNull();
        expect(missile.submunition!.id).toEqual(217);
        expect(turret.submunition!.id).toEqual(130);
    });

    it("should parse submunitions theta", function() {
        expect(unguided.submunition!.theta).toEqual(27);
        expect(missile.submunition!.theta).toEqual(-18);
        expect(turret.submunition!.theta).toEqual(32767);
    });

    it("should parse submunitions limit", function() {
        expect(unguided.submunition!.limit).toEqual(28);
        expect(missile.submunition!.limit).toEqual(19);
        expect(turret.submunition!.limit).toEqual(32767);
    });

    it("should not include subs if the sub id is 0", function() {
        expect(nosubs.submunition).toBeNull();
    });

    it("should parse proxSafety", function() {
        expect(unguided.proxSafety).toEqual(50);
        expect(missile.proxSafety).toEqual(41);
        expect(turret.proxSafety).toEqual(32767);
    });

    it("should parse spinBeforeProxSafety", function() {
        expect(unguided.spinBeforeProxSafety).toEqual(true);
        expect(missile.spinBeforeProxSafety).toEqual(false);
        expect(turret.spinBeforeProxSafety).toEqual(true);
    });

    it("should parse spinStopOnLastFrame", function() {
        expect(unguided.spinStopOnLastFrame).toEqual(false);
        expect(missile.spinStopOnLastFrame).toEqual(true);
        expect(turret.spinStopOnLastFrame).toEqual(true);
    });

    it("should parse proxIgnoreAsteroids", function() {
        expect(unguided.proxIgnoreAsteroids).toEqual(false);
        expect(beam.proxIgnoreAsteroids).toEqual(false);
        expect(missile.proxIgnoreAsteroids).toEqual(false);
        expect(turret.proxIgnoreAsteroids).toEqual(true);
    });

    it("should parse proxHitAll", function() {
        // true by default for all but guided type
        expect(unguided.proxHitAll).toEqual(true);
        expect(beam.proxHitAll).toEqual(true);
        expect(missile.proxHitAll).toEqual(false);
        expect(turret.proxHitAll).toEqual(true);
    });

    it("should parse submunitions fireAtNearest", function() {
        expect(unguided.submunition!.fireAtNearest).toEqual(false);
        expect(missile.submunition!.fireAtNearest).toEqual(true);
        expect(turret.submunition!.fireAtNearest).toEqual(false);
    });

    it("should parse submunitions subIfExpire", function() {
        expect(unguided.submunition!.subIfExpire).toEqual(true);
        expect(missile.submunition!.subIfExpire).toEqual(true);
        expect(turret.submunition!.subIfExpire).toEqual(false);
    });

    it("should parse showAmmo", function() {
        expect(unguided.showAmmo).toEqual(true);
        expect(beam.showAmmo).toEqual(false);
        expect(missile.showAmmo).toEqual(false);
        expect(turret.showAmmo).toEqual(true);
    });

    it("should parse fireOnlyIfKeyCarried", function() {
        expect(unguided.fireOnlyIfKeyCarried).toEqual(false);
        expect(beam.fireOnlyIfKeyCarried).toEqual(true);
        expect(missile.fireOnlyIfKeyCarried).toEqual(false);
        expect(turret.fireOnlyIfKeyCarried).toEqual(true);
    });
    it("should parse npcCantUse", function() {
        expect(unguided.npcCantUse).toEqual(false);
        expect(beam.npcCantUse).toEqual(true);
        expect(missile.npcCantUse).toEqual(false);
        expect(turret.npcCantUse).toEqual(true);
    });

    it("should parse useFiringAnimation", function() {
        expect(unguided.useFiringAnimation).toEqual(false);
        expect(beam.useFiringAnimation).toEqual(false);
        expect(missile.useFiringAnimation).toEqual(true);
        expect(turret.useFiringAnimation).toEqual(true);
    });

    it("should parse planetType", function() {
        expect(unguided.planetType).toEqual(false);
        expect(beam.planetType).toEqual(true);
        expect(missile.planetType).toEqual(true);
        expect(turret.planetType).toEqual(false);
    });

    it("should parse hideIfNoAmmo", function() {
        expect(unguided.hideIfNoAmmo).toEqual(false);
        expect(beam.hideIfNoAmmo).toEqual(false);
        expect(missile.hideIfNoAmmo).toEqual(true);
        expect(turret.hideIfNoAmmo).toEqual(true);
    });

    it("should parse disableOnly", function() {
        expect(unguided.disableOnly).toEqual(false);
        expect(beam.disableOnly).toEqual(true);
        expect(missile.disableOnly).toEqual(true);
        expect(turret.disableOnly).toEqual(false);
    });

    it("should parse beamUnderShip", function() {
        expect(unguided.beamUnderShip).toEqual(false);
        expect(beam.beamUnderShip).toEqual(true);
        expect(missile.beamUnderShip).toEqual(false);
        expect(turret.beamUnderShip).toEqual(false);
    });

    it("should parse fireWhileCloaked", function() {
        expect(unguided.fireWhileCloaked).toEqual(false);
        expect(beam.fireWhileCloaked).toEqual(true);
        expect(missile.fireWhileCloaked).toEqual(true);
        expect(turret.fireWhileCloaked).toEqual(false);
    });

    it("should parse asteroidMiner", function() {
        expect(unguided.asteroidMiner).toEqual(false);
        expect(beam.asteroidMiner).toEqual(true);
        expect(missile.asteroidMiner).toEqual(false);
        expect(turret.asteroidMiner).toEqual(true);
    });

    it("should parse ionization", function() {
        expect(unguided.ionization).toEqual(29);
        expect(beam.ionization).toEqual(0);
        expect(missile.ionization).toEqual(20);
        expect(turret.ionization).toEqual(32767);
    });

    it("should parse hitParticles number", function() {
        expect(unguided.hitParticles.count).toEqual(41);
        expect(beam.hitParticles.count).toEqual(-1);
        expect(missile.hitParticles.count).toEqual(32);
        expect(turret.hitParticles.count).toEqual(32767);
    });

    it("should parse hitParticles life", function() {
        expect(unguided.hitParticles.lifeMin).toEqual(43);
        expect(unguided.hitParticles.lifeMax).toEqual(43);
        expect(beam.hitParticles.lifeMin).toEqual(-1);
        expect(beam.hitParticles.lifeMax).toEqual(-1);
        expect(missile.hitParticles.lifeMin).toEqual(34);
        expect(missile.hitParticles.lifeMax).toEqual(34);
        expect(turret.hitParticles.lifeMin).toEqual(32767);
        expect(turret.hitParticles.lifeMax).toEqual(32767);
    });

    it("should parse hitParticles velocity", function() {
        expect(unguided.hitParticles.velocity).toEqual(42);
        expect(beam.hitParticles.velocity).toEqual(-1);
        expect(missile.hitParticles.velocity).toEqual(33);
        expect(turret.hitParticles.velocity).toEqual(32767);
    });

    it("should parse hitParticles color", function() {
        expect(unguided.hitParticles.color).toEqual(0xFF2C2D2E);
        expect(beam.hitParticles.color).toEqual(0xFF000000);
        expect(missile.hitParticles.color).toEqual(0xFF232425);
        expect(turret.hitParticles.color).toEqual(0xFFFFFFFF);
    });

    it("should parse exitType", function() {
        expect(unguided.exitType).toEqual("center");
        expect(beam.exitType).toEqual("gun");
        expect(missile.exitType).toEqual("turret");
        expect(turret.exitType).toEqual("guided");
        expect(beamTurret.exitType).toEqual("beam");
    });

    it("should parse burstCount", function() {
        expect(unguided.burstCount).toEqual(23);
        expect(beam.burstCount).toEqual(-1);
        expect(missile.burstCount).toEqual(14);
        expect(turret.burstCount).toEqual(32767);
    });

    it("should parse burstReload", function() {
        expect(unguided.burstReload).toEqual(24);
        expect(beam.burstReload).toEqual(-1);
        expect(missile.burstReload).toEqual(15);
        expect(turret.burstReload).toEqual(32767);
    });

    it("should parse jamVuln 1", function() {
        expect(missile.jamVuln[0]).toEqual(43);
    });

    it("should parse jamVuln 2", function() {
        expect(missile.jamVuln[1]).toEqual(44);
    });

    it("should parse jamVuln 3", function() {
        expect(missile.jamVuln[2]).toEqual(45);
    });

    it("should parse jamVuln 4", function() {
        expect(missile.jamVuln[3]).toEqual(46);
    });

    it("should parse oneAmmoPerBurst", function() {
        expect(unguided.oneAmmoPerBurst).toEqual(false);
        expect(beam.oneAmmoPerBurst).toEqual(true);
        expect(missile.oneAmmoPerBurst).toEqual(true);
        expect(turret.oneAmmoPerBurst).toEqual(false);
    });

    it("should parse translucent", function() {
        expect(unguided.translucent).toEqual(false);
        expect(beam.translucent).toEqual(false);
        expect(missile.translucent).toEqual(true);
        expect(turret.translucent).toEqual(true);
    });

    // prevents other weaps from firing
    it("should parse exclusive", function() {
        expect(unguided.exclusive).toEqual(false);
        expect(beam.exclusive).toEqual(true);
        expect(missile.exclusive).toEqual(true);
        expect(turret.exclusive).toEqual(false);
    });

    it("should parse durability", function() {
        expect(unguided.durability).toEqual(0);
        expect(beam.durability).toEqual(0);
        expect(missile.durability).toEqual(42);
        expect(turret.durability).toEqual(0);
    });

    it("should parse turnRate", function() {
        expect(unguided.turnRate).toEqual(0);
        expect(beam.turnRate).toEqual(0);
        expect(missile.turnRate).toEqual(9);
        expect(turret.turnRate).toEqual(0);
    });

    it("should parse maxAmmo", function() {
        expect(unguided.maxAmmo).toEqual(22);
        expect(beam.maxAmmo).toEqual(-1);
        expect(missile.maxAmmo).toEqual(13);
        expect(turret.maxAmmo).toEqual(32767);
    });

    it("should parse maxAmmo", function() {
        expect(unguided.maxAmmo).toEqual(22);
        expect(beam.maxAmmo).toEqual(-1);
        expect(missile.maxAmmo).toEqual(13);
        expect(turret.maxAmmo).toEqual(32767);
    });

    it("should parse recoil", function() {
        expect(unguided.recoil).toEqual(14);
        expect(beam.recoil).toEqual(114);
        expect(missile.recoil).toEqual(4);
        expect(turret.recoil).toEqual(32767);
        expect(beamTurret.recoil).toEqual(0);
    });

    it("should parse lightningDensity", function() {
        expect(beam.lightningDensity).toEqual(28);
        expect(beamTurret.lightningDensity).toEqual(10);
    });

    it("should parse lightningAmplitude", function() {
        expect(beam.lightningAmplitude).toEqual(29);
        expect(beamTurret.lightningAmplitude).toEqual(15);
    });

    it("should parse ionizeColor", function() {
        expect(unguided.ionizeColor).toEqual(0xFF1E1F20);
        expect(beam.ionizeColor).toEqual(0xFF000000);
        expect(missile.ionizeColor).toEqual(0xFF151617);
        expect(turret.ionizeColor).toEqual(0xFFFFFFFF);
        expect(beamTurret.ionizeColor).toEqual(0xFFA55AA5);
    });
});
