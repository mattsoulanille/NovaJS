global.Promise = require("bluebird"); // For stacktraces

import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import "mocha";
import { readResourceFork, ResourceMap } from "resourceforkjs";
import { WeapResource } from "../../src/resource_parsers/WeapResource";
import { defaultIDSpace } from "./DefaultIDSpace";
import { assert } from "chai";

before(function() {
    chai.should();
    chai.use(chaiAsPromised);
});

const expect = chai.expect;

describe("WeapResource", function() {

    // Weaps don't depend on other resources.
    var idSpace = defaultIDSpace;

    var rf: ResourceMap;
    var unguided: WeapResource;
    var beam: WeapResource;
    var beamTurret: WeapResource;
    var missile: WeapResource;
    var turret: WeapResource;
    var nosubs: WeapResource;

    before(async function() {
        rf = await readResourceFork("novaparse/test/resource_parsers/files/weap.ndat", false);
        var weaps = rf.wëap;
        unguided = new WeapResource(weaps[128], idSpace);
        beam = new WeapResource(weaps[129], idSpace);
        missile = new WeapResource(weaps[130], idSpace);
        turret = new WeapResource(weaps[131], idSpace);
        beamTurret = new WeapResource(weaps[132], idSpace);
        nosubs = new WeapResource(weaps[264], idSpace);
    });


    it("should parse shield damage", function() {
        assert.equal(unguided.shieldDamage, 11);
        assert.equal(beam.shieldDamage, 111);
        assert.equal(missile.shieldDamage, 1);
        assert.equal(turret.shieldDamage, 32767);
    });

    it("should parse armor damage", function() {
        assert.equal(unguided.armorDamage, 12);
        assert.equal(beam.armorDamage, 112);
        assert.equal(missile.armorDamage, 2);
        assert.equal(turret.armorDamage, 32767);
    });

    it("should parse impact", function() {
        assert.equal(unguided.impact, 13);
        assert.equal(beam.impact, 113);
        assert.equal(missile.impact, 3);
        assert.equal(turret.impact, 32767);
    });

    it("should parse decay", function() {
        assert.equal(unguided.decay, 15);
        assert.equal(beam.decay, 115);
        assert.equal(missile.decay, 5);
        assert.equal(turret.decay, 32767);
    });

    it("should parse reload time", function() {
        assert.equal(unguided.reload, 16);
        assert.equal(beam.reload, 116);
        assert.equal(missile.reload, 6);
        assert.equal(turret.reload, 32767);
    });

    it("should parse shot speed", function() {
        assert.equal(unguided.speed, 17);
        assert.equal(beam.speed, 117); // is this applicable
        assert.equal(missile.speed, 7);
        assert.equal(turret.speed, 32767);
    });

    it("should parse duration", function() {
        assert.equal(unguided.duration, 18);
        assert.equal(beam.duration, 118);
        assert.equal(missile.duration, 8);
        assert.equal(turret.duration, 32767);
    });

    it("should parse guidance", function() {
        assert.equal(unguided.guidance, "unguided");
        assert.equal(beam.guidance, "beam");
        assert.equal(missile.guidance, "guided");
        assert.equal(turret.guidance, "turret");
        assert.equal(beamTurret.guidance, "beamTurret");
    });

    it("should parse turn rate", function() {
        assert.equal(missile.turnRate, 9);
    });

    it("should parse accuracy", function() {
        assert.equal(unguided.accuracy, 19);
        assert.equal(beam.accuracy, 0);
        assert.equal(missile.accuracy, 10);
        assert.equal(turret.accuracy, 360);
    });

    it("should parse fireAtFixedAngle", function() {
        assert.equal(unguided.firesAtFixedAngle, false);
        assert.equal(beam.firesAtFixedAngle, false);
        assert.equal(missile.firesAtFixedAngle, true);
        assert.equal(turret.firesAtFixedAngle, false);

    });

    it("should parse AmmoType", function() {
        assert.equal(unguided.ammoType, -1);
        assert.equal(beam.ammoType, -1540); // uses 54 fuel per shot
        assert.equal(missile.ammoType, 2);
        assert.equal(turret.ammoType, 255);
    });

    it("should parse graphic", function() {
        assert.equal(unguided.graphic, 3255);
        assert.equal(beam.graphic, null);
        assert.equal(missile.graphic, 3244);
        assert.equal(turret.graphic, 3001);
    });

    it("should parse sound", function() {
        assert.equal(unguided.sound, 221);
        assert.equal(beam.sound, null);
        assert.equal(missile.sound, 212);
        assert.equal(turret.sound, 263);
    });

    it("should parse explosion", function() {
        assert.equal(unguided.explosion, 147);
        assert.equal(beam.explosion, null);
        assert.equal(missile.explosion, 138);
        assert.equal(turret.explosion, 191);
    });

    it("should parse explosion128sparks", function() {
        assert.equal(unguided.explosion128sparks, false);
        //assert.equal(beam.explosion128sparks, -1);
        assert.equal(missile.explosion128sparks, true);
        assert.equal(turret.explosion128sparks, true);

    });

    it("should parse proxRadius", function() {
        assert.equal(unguided.proxRadius, 49);
        //assert.equal(beam.proxRadius, 0);
        assert.equal(missile.proxRadius, 40);
        assert.equal(turret.proxRadius, 32767);
    });

    it("should parse blastRadius", function() {
        assert.equal(unguided.blastRadius, 48);
        //assert.equal(beam.blastRadius, 0);
        assert.equal(missile.blastRadius, 39);
        assert.equal(turret.blastRadius, 32767);
    });

    it("should parse spinShots", function() {
        assert.equal(unguided.spinShots, false);
        //assert.equal(beam.spinShots, 0);
        assert.equal(missile.spinShots, true);
        assert.equal(turret.spinShots, true);
    });

    // see nova bible beamWidth
    it("should parse spinRate", function() {
        assert.equal(missile.spinRate, 123);
        assert.equal(turret.spinRate, 221);
    });

    it("should parse primary/secondary", function() {
        assert.equal(unguided.fireGroup, "primary");
        assert.equal(beam.fireGroup, "primary");
        assert.equal(missile.fireGroup, "secondary");
        assert.equal(turret.fireGroup, "primary");
    });


    it("should parse startSpinningOnFirstFrame", function() {
        //assert.equal(unguided.startSpinningOnFirstFrame, false);
        //assert.equal(beam.startSpinningOnFirstFrame, 0);
        assert.equal(missile.startSpinningOnFirstFrame, true);
        assert.equal(turret.startSpinningOnFirstFrame, false);
    });

    it("should parse dontFireAtFastShips", function() {
        assert.equal(missile.dontFireAtFastShips, true);
    });

    it("should parse loopSound", function() {
        assert.equal(unguided.loopSound, false);
        //assert.equal(beam.loopSound, "primary");
        assert.equal(missile.loopSound, true);
        assert.equal(turret.loopSound, false);
    });


    // these next tests need more test cases
    it("should parse passThroughShields", function() {
        assert.equal(unguided.passThroughShields, false);
        assert.equal(beam.passThroughShields, true);
        assert.equal(missile.passThroughShields, false);
        assert.equal(turret.passThroughShields, true);
    });

    it("should parse fireSimultaneously", function() {
        assert.equal(unguided.fireSimultaneously, false);
        assert.equal(beam.fireSimultaneously, true);
        assert.equal(missile.fireSimultaneously, false);
        assert.equal(turret.fireSimultaneously, true);
    });

    it("should parse vulnerableToPD", function() {
        assert.equal(missile.vulnerableToPD, true);
    });

    it("should parse hitsFiringShip", function() {
        assert.equal(unguided.hitsFiringShip, true);
        //assert.equal(beam.hitsFiringShip, true);
        assert.equal(missile.hitsFiringShip, false);
        assert.equal(turret.hitsFiringShip, true);
    });

    it("should parse smallCicnSmoke", function() {
        assert.equal(unguided.smallCicnSmoke, false);
        //assert.equal(beam.smallCicnSmoke, false);
        assert.equal(missile.smallCicnSmoke, false);
        assert.equal(turret.smallCicnSmoke, true);
    });

    it("should parse bigCicnSmoke", function() {
        assert.equal(unguided.bigCicnSmoke, false);
        //assert.equal(beam.bigCicnSmoke, false);
        assert.equal(missile.bigCicnSmoke, true);
        assert.equal(turret.bigCicnSmoke, false);
    });

    it("should parse persistentCicnSmoke", function() {
        assert.equal(unguided.persistentCicnSmoke, false);
        //assert.equal(beam.persistentCicnSmoke, false);
        assert.equal(missile.persistentCicnSmoke, false);
        assert.equal(turret.persistentCicnSmoke, true);
    });

    it("should parse turretBlindSpots", function() {
        var blindSpots = turret.turretBlindSpots;
        assert.equal(blindSpots.front, false);
        assert.equal(blindSpots.side, true);
        assert.equal(blindSpots.back, false);
    });

    it("should parse flak", function() {
        assert.equal(unguided.flak, false);
        //assert.equal(beam.flak, false);
        assert.equal(missile.flak, true);
        assert.equal(turret.flak, false);
    });

    it("should parse passOverAsteroids", function() {
        assert.equal(unguided.passOverAsteroids, false);
        assert.equal(beam.passOverAsteroids, false);
        assert.equal(missile.passOverAsteroids, true);
        assert.equal(turret.passOverAsteroids, true);
    });

    it("should parse decoyedByAsteroids", function() {
        //assert.equal(unguided.decoyedByAsteroids, false);
        //assert.equal(beam.decoyedByAsteroids, false);
        assert.equal(missile.decoyedByAsteroids, true);
        //assert.equal(turret.decoyedByAsteroids, false);
    });

    it("should parse confusedByInterference", function() {
        assert.equal(missile.confusedByInterference, true);
    });

    it("should parse turnsAwayIfJammed", function() {
        assert.equal(missile.turnsAwayIfJammed, true);
    });

    it("should parse cantFireWhileIonized", function() {
        assert.equal(unguided.cantFireWhileIonized, false);
        assert.equal(beam.cantFireWhileIonized, true);
        assert.equal(missile.cantFireWhileIonized, true);
        assert.equal(turret.cantFireWhileIonized, false);
    });

    it("should parse loseLockIfNotAhead", function() {
        assert.equal(missile.loseLockIfNotAhead, true);
    });

    it("should parse attackParentIfJammed", function() {
        assert.equal(missile.attackParentIfJammed, true);
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
        assert.equal(unguided.decay, 15);
        assert.equal(beam.decay, 115);
        assert.equal(missile.decay, 5);
        assert.equal(turret.decay, 32767);
    });

    it("should parse trailParticles number", function() {
        assert.equal(unguided.trailParticles.count, 34);
        assert.equal(beam.trailParticles.count, -1);
        assert.equal(missile.trailParticles.count, 25);
        assert.equal(turret.trailParticles.count, 32767);
    });

    it("should parse trailParticles lifeMin", function() {
        assert.equal(unguided.trailParticles.lifeMin, 35);
        assert.equal(beam.trailParticles.lifeMin, -1);
        assert.equal(missile.trailParticles.lifeMin, 26);
        assert.equal(turret.trailParticles.lifeMin, 32767);
    });

    it("should parse trailParticles lifeMax", function() {
        assert.equal(unguided.trailParticles.lifeMax, 40);
        assert.equal(beam.trailParticles.lifeMax, -1);
        assert.equal(missile.trailParticles.lifeMax, 31);
        assert.equal(turret.trailParticles.lifeMax, 32767);
    });


    it("should parse trailParticles color", function() {
        assert.equal(unguided.trailParticles.color, 0xFF242526);
        assert.equal(beam.trailParticles.color, 0xFF000000);
        assert.equal(missile.trailParticles.color, 0xFF1B1C1D);
        assert.equal(turret.trailParticles.color, 0xFFFFFFFF);
    });

    it("should parse beamLength", function() {
        assert.equal(beam.beamLength, 19);
    });

    it("should parse beamWidth", function() {
        assert.equal(beam.beamWidth, 20);
    });

    it("should parse coronaFalloff", function() {
        assert.equal(beam.coronaFalloff, 24);
    });

    it("should parse beamColor", function() {
        assert.equal(beam.beamColor, 0xFF151617);
    });

    it("should parse coronaColor", function() {
        assert.equal(beam.coronaColor, 0xFF191A1B);
    });

    it("should parse submunitions count", function() {
        assert.propertyVal(unguided.submunition, "count", 25);
        assert.propertyVal(missile.submunition, "count", 16);
        assert.propertyVal(turret.submunition, "count", 32767);
    });

    it("should parse submunitions type", function() {
        assert.propertyVal(unguided.submunition, "id", 226);
        assert(beam.submunition === null);
        assert.propertyVal(missile.submunition, "id", 217);
        assert.propertyVal(turret.submunition, "id", 130);
    });

    it("should parse submunitions theta", function() {
        assert.propertyVal(unguided.submunition, "theta", 27);
        assert.propertyVal(missile.submunition, "theta", -18);
        assert.propertyVal(turret.submunition, "theta", 32767);
    });

    it("should parse submunitions limit", function() {
        assert.propertyVal(unguided.submunition, "limit", 28);
        assert.propertyVal(missile.submunition, "limit", 19);
        assert.propertyVal(turret.submunition, "limit", 32767);
    });

    it("should not include subs if the sub id is 0", function() {
        expect(nosubs.submunition).to.be.null;
    });

    it("should parse proxSafety", function() {
        assert.equal(unguided.proxSafety, 50);
        assert.equal(missile.proxSafety, 41);
        assert.equal(turret.proxSafety, 32767);
    });

    it("should parse spinBeforeProxSafety", function() {
        assert.equal(unguided.spinBeforeProxSafety, true);
        assert.equal(missile.spinBeforeProxSafety, false);
        assert.equal(turret.spinBeforeProxSafety, true);
    });

    it("should parse spinStopOnLastFrame", function() {
        assert.equal(unguided.spinStopOnLastFrame, false);
        assert.equal(missile.spinStopOnLastFrame, true);
        assert.equal(turret.spinStopOnLastFrame, true);
    });

    it("should parse proxIgnoreAsteroids", function() {
        assert.equal(unguided.proxIgnoreAsteroids, false);
        assert.equal(beam.proxIgnoreAsteroids, false);
        assert.equal(missile.proxIgnoreAsteroids, false);
        assert.equal(turret.proxIgnoreAsteroids, true);
    });

    it("should parse proxHitAll", function() {
        // true by default for all but guided type
        assert.equal(unguided.proxHitAll, true);
        assert.equal(beam.proxHitAll, true);
        assert.equal(missile.proxHitAll, false);
        assert.equal(turret.proxHitAll, true);
    });

    it("should parse submunitions fireAtNearest", function() {
        assert.propertyVal(unguided.submunition, "fireAtNearest", false);
        assert.propertyVal(missile.submunition, "fireAtNearest", true);
        assert.propertyVal(turret.submunition, "fireAtNearest", false);
    });

    it("should parse submunitions subIfExpire", function() {
        assert.propertyVal(unguided.submunition, "subIfExpire", true);
        assert.propertyVal(missile.submunition, "subIfExpire", true);
        assert.propertyVal(turret.submunition, "subIfExpire", false);
    });

    it("should parse showAmmo", function() {
        assert.equal(unguided.showAmmo, true);
        assert.equal(beam.showAmmo, false);
        assert.equal(missile.showAmmo, false);
        assert.equal(turret.showAmmo, true);
    });

    it("should parse fireOnlyIfKeyCarried", function() {
        assert.equal(unguided.fireOnlyIfKeyCarried, false);
        assert.equal(beam.fireOnlyIfKeyCarried, true);
        assert.equal(missile.fireOnlyIfKeyCarried, false);
        assert.equal(turret.fireOnlyIfKeyCarried, true);
    });
    it("should parse npcCantUse", function() {
        assert.equal(unguided.npcCantUse, false);
        assert.equal(beam.npcCantUse, true);
        assert.equal(missile.npcCantUse, false);
        assert.equal(turret.npcCantUse, true);
    });

    it("should parse useFiringAnimation", function() {
        assert.equal(unguided.useFiringAnimation, false);
        assert.equal(beam.useFiringAnimation, false);
        assert.equal(missile.useFiringAnimation, true);
        assert.equal(turret.useFiringAnimation, true);
    });

    it("should parse planetType", function() {
        assert.equal(unguided.planetType, false);
        assert.equal(beam.planetType, true);
        assert.equal(missile.planetType, true);
        assert.equal(turret.planetType, false);
    });

    it("should parse hideIfNoAmmo", function() {
        assert.equal(unguided.hideIfNoAmmo, false);
        assert.equal(beam.hideIfNoAmmo, false);
        assert.equal(missile.hideIfNoAmmo, true);
        assert.equal(turret.hideIfNoAmmo, true);
    });

    it("should parse disableOnly", function() {
        assert.equal(unguided.disableOnly, false);
        assert.equal(beam.disableOnly, true);
        assert.equal(missile.disableOnly, true);
        assert.equal(turret.disableOnly, false);
    });

    it("should parse beamUnderShip", function() {
        assert.equal(unguided.beamUnderShip, false);
        assert.equal(beam.beamUnderShip, true);
        assert.equal(missile.beamUnderShip, false);
        assert.equal(turret.beamUnderShip, false);
    });

    it("should parse fireWhileCloaked", function() {
        assert.equal(unguided.fireWhileCloaked, false);
        assert.equal(beam.fireWhileCloaked, true);
        assert.equal(missile.fireWhileCloaked, true);
        assert.equal(turret.fireWhileCloaked, false);
    });

    it("should parse asteroidMiner", function() {
        assert.equal(unguided.asteroidMiner, false);
        assert.equal(beam.asteroidMiner, true);
        assert.equal(missile.asteroidMiner, false);
        assert.equal(turret.asteroidMiner, true);
    });

    it("should parse ionization", function() {
        assert.equal(unguided.ionization, 29);
        assert.equal(beam.ionization, 0);
        assert.equal(missile.ionization, 20);
        assert.equal(turret.ionization, 32767);
    });

    it("should parse hitParticles number", function() {
        assert.equal(unguided.hitParticles.count, 41);
        assert.equal(beam.hitParticles.count, -1);
        assert.equal(missile.hitParticles.count, 32);
        assert.equal(turret.hitParticles.count, 32767);
    });

    it("should parse hitParticles life", function() {
        assert.equal(unguided.hitParticles.lifeMin, 43);
        assert.equal(unguided.hitParticles.lifeMax, 43);
        assert.equal(beam.hitParticles.lifeMin, -1);
        assert.equal(beam.hitParticles.lifeMax, -1);
        assert.equal(missile.hitParticles.lifeMin, 34);
        assert.equal(missile.hitParticles.lifeMax, 34);
        assert.equal(turret.hitParticles.lifeMin, 32767);
        assert.equal(turret.hitParticles.lifeMax, 32767);
    });

    it("should parse hitParticles velocity", function() {
        assert.equal(unguided.hitParticles.velocity, 42);
        assert.equal(beam.hitParticles.velocity, -1);
        assert.equal(missile.hitParticles.velocity, 33);
        assert.equal(turret.hitParticles.velocity, 32767);
    });

    it("should parse hitParticles color", function() {
        assert.equal(unguided.hitParticles.color, 0xFF2C2D2E);
        assert.equal(beam.hitParticles.color, 0xFF000000);
        assert.equal(missile.hitParticles.color, 0xFF232425);
        assert.equal(turret.hitParticles.color, 0xFFFFFFFF);
    });

    it("should parse exitType", function() {
        assert.equal(unguided.exitType, "center");
        assert.equal(beam.exitType, "gun");
        assert.equal(missile.exitType, "turret");
        assert.equal(turret.exitType, "guided");
        assert.equal(beamTurret.exitType, "beam");
    });

    it("should parse burstCount", function() {
        assert.equal(unguided.burstCount, 23);
        assert.equal(beam.burstCount, -1);
        assert.equal(missile.burstCount, 14);
        assert.equal(turret.burstCount, 32767);
    });

    it("should parse burstReload", function() {
        assert.equal(unguided.burstReload, 24);
        assert.equal(beam.burstReload, -1);
        assert.equal(missile.burstReload, 15);
        assert.equal(turret.burstReload, 32767);
    });

    it("should parse jamVuln 1", function() {
        assert.equal(missile.jamVuln[0], 43);
    });

    it("should parse jamVuln 2", function() {
        assert.equal(missile.jamVuln[1], 44);
    });

    it("should parse jamVuln 3", function() {
        assert.equal(missile.jamVuln[2], 45);
    });

    it("should parse jamVuln 4", function() {
        assert.equal(missile.jamVuln[3], 46);
    });

    it("should parse oneAmmoPerBurst", function() {
        assert.equal(unguided.oneAmmoPerBurst, false);
        assert.equal(beam.oneAmmoPerBurst, true);
        assert.equal(missile.oneAmmoPerBurst, true);
        assert.equal(turret.oneAmmoPerBurst, false);
    });

    it("should parse translucent", function() {
        assert.equal(unguided.translucent, false);
        assert.equal(beam.translucent, false);
        assert.equal(missile.translucent, true);
        assert.equal(turret.translucent, true);
    });

    // prevents other weaps from firing
    it("should parse exclusive", function() {
        assert.equal(unguided.exclusive, false);
        assert.equal(beam.exclusive, true);
        assert.equal(missile.exclusive, true);
        assert.equal(turret.exclusive, false);
    });

    it("should parse durability", function() {
        assert.equal(unguided.durability, 0);
        assert.equal(beam.durability, 0);
        assert.equal(missile.durability, 42);
        assert.equal(turret.durability, 0);
    });

    it("should parse turnRate", function() {
        assert.equal(unguided.turnRate, 0);
        assert.equal(beam.turnRate, 0);
        assert.equal(missile.turnRate, 9);
        assert.equal(turret.turnRate, 0);
    });

    it("should parse maxAmmo", function() {
        assert.equal(unguided.maxAmmo, 22);
        assert.equal(beam.maxAmmo, -1);
        assert.equal(missile.maxAmmo, 13);
        assert.equal(turret.maxAmmo, 32767);
    });

    it("should parse maxAmmo", function() {
        assert.equal(unguided.maxAmmo, 22);
        assert.equal(beam.maxAmmo, -1);
        assert.equal(missile.maxAmmo, 13);
        assert.equal(turret.maxAmmo, 32767);
    });

    it("should parse recoil", function() {
        assert.equal(unguided.recoil, 14);
        assert.equal(beam.recoil, 114);
        assert.equal(missile.recoil, 4);
        assert.equal(turret.recoil, 32767);
        assert.equal(beamTurret.recoil, 0);
    });

    it("should parse lightningDensity", function() {
        assert.equal(beam.lightningDensity, 28);
        assert.equal(beamTurret.lightningDensity, 10);
    });

    it("should parse lightningAmplitude", function() {
        assert.equal(beam.lightningAmplitude, 29);
        assert.equal(beamTurret.lightningAmplitude, 15);
    });

    it("should parse ionizeColor", function() {
        assert.equal(unguided.ionizeColor, 0xFF1E1F20);
        assert.equal(beam.ionizeColor, 0xFF000000);
        assert.equal(missile.ionizeColor, 0xFF151617);
        assert.equal(turret.ionizeColor, 0xFFFFFFFF);
        assert.equal(beamTurret.ionizeColor, 0xFFA55AA5);
    });

});
