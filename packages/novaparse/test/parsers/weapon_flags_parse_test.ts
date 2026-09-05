import "jasmine";
import { BeamWeaponData, ProjectileWeaponData } from "novadatainterface/weapon_data";
import { WeaponParse } from "../../src/parsers/weapon_parse.js";
import { WeapResource } from "../../src/resource_parsers/weap_resource.js";
import { FPS } from "../../src/parsers/constants.js";

/**
 * Builds a WeapResource from a hand-assembled 134-byte wëap record, so
 * these specs pin the BITS the EVN Bible names (Flags 0x0008, Seeker
 * 0x0020, Flags2 0x0100/0x0400/0x4000, Flags3 0x0004/0x0020) all the way
 * through to WeaponData — the fields the review found parsed by
 * weap_resource and then dropped on the floor by weapon_parse.
 *
 * Every id field is -1 (none) so nothing is looked up; the ones that
 * matter here are written at the template offsets weap_resource reads.
 */
function weapFromBytes(fields: {
    reload?: number, duration?: number, guidance: number,
    accuracy?: number, flags?: number, seeker?: number, decay?: number,
    coronaFalloff?: number, flags2?: number, flags3?: number,
}): WeapResource {
    const buffer = new ArrayBuffer(134);
    const view = new DataView(buffer);
    const int16 = (offset: number, value: number) => view.setInt16(offset, value);
    int16(0, fields.reload ?? 30);
    int16(2, fields.duration ?? 10);
    int16(8, fields.guidance);
    int16(12, -1);                   // AmmoType: unlimited
    int16(14, 0);                    // Graphic: spïn 3000 (faked below)
    int16(16, fields.accuracy ?? 0);
    int16(18, -1);                   // Sound: none
    int16(22, -1);                   // ExplodType: none
    int16(28, fields.flags ?? 0);
    int16(30, fields.seeker ?? 0);
    int16(32, -1);                   // SmokeSet: none
    int16(34, fields.decay ?? 0);
    int16(52, fields.coronaFalloff ?? 0);
    int16(62, 0);                    // SubCount: none
    int16(64, -1);                   // SubType: none
    int16(72, fields.flags2 ?? 0);
    int16(88, -1);                   // ExitType: center
    int16(102, fields.flags3 ?? 0);

    // A projectile weapon must name a graphic; a one-frame sprite sheet.
    const rled = { globalID: "test:rled", numberOfFrames: 1 };
    const spin = { spriteID: 1000, idSpace: { rlëD: { 1000: rled } } };
    const weap = new WeapResource({ id: 300, name: "Test", data: view } as any, {
        "snd ": {}, bööm: {}, spïn: { 3000: spin }, wëap: {}, shïp: {}, dësc: {},
    } as any);
    weap.globalID = "test:300";
    weap.prefix = "test";
    return weap;
}

const UNGUIDED = -1;
const BEAM = 0;
const GUIDED = 1;

async function parse(weap: WeapResource) {
    const notFound: string[] = [];
    const data = await WeaponParse(weap, m => notFound.push(m));
    return { data, notFound };
}

describe("wëap behaviour flags reach WeaponData", () => {
    it("carries none of the flags when none are set", async () => {
        const { data } = await parse(weapFromBytes({ guidance: UNGUIDED }));
        expect(data.fireWhileCloaked).toBeFalse();
        expect(data.cantFireWhileIonized).toBeFalse();
        expect(data.cantFireUntilShotExpires).toBeFalse();
        expect(data.exclusive).toBeFalse();
        expect(data.npcCantUse).toBeFalse();
        expect(data.dontFireAtFastShips).toBeFalse();
        expect(data.planetType).toBeFalse();
        expect(data.firesAtFixedAngle).toBeFalse();
    });

    it("Flags2 0x4000: weapon can be fired while cloaked", async () => {
        const { data } = await parse(weapFromBytes({ guidance: GUIDED, flags2: 0x4000 }));
        expect(data.fireWhileCloaked).toBeTrue();
    });

    it("Seeker 0x0020: can't fire if ship is ionized", async () => {
        const { data } = await parse(weapFromBytes({ guidance: GUIDED, seeker: 0x0020 }));
        expect(data.cantFireWhileIonized).toBeTrue();
    });

    it("Flags3 0x0004: can't fire until the previous shot expires", async () => {
        const { data } = await parse(weapFromBytes({ guidance: UNGUIDED, flags3: 0x0004 }));
        expect(data.cantFireUntilShotExpires).toBeTrue();
    });

    it("Flags3 0x0020: weapon is exclusive", async () => {
        const { data } = await parse(weapFromBytes({ guidance: UNGUIDED, flags3: 0x0020 }));
        expect(data.exclusive).toBeTrue();
    });

    it("Flags2 0x0100: AI ships won't use this weapon", async () => {
        const { data } = await parse(weapFromBytes({ guidance: UNGUIDED, flags2: 0x0100 }));
        expect(data.npcCantUse).toBeTrue();
    });

    it("Flags 0x0008: don't fire guided weapons at fast ships", async () => {
        const { data } = await parse(weapFromBytes({ guidance: GUIDED, flags: 0x0008 }));
        expect(data.dontFireAtFastShips).toBeTrue();
    });

    it("Flags2 0x0400: planet-type weapon", async () => {
        const { data } = await parse(weapFromBytes({ guidance: GUIDED, flags2: 0x0400 }));
        expect(data.planetType).toBeTrue();
    });

    it("does not confuse neighbouring bits", async () => {
        // Flags2 0x0200 (uses the weapon sprite) and 0x0800 (hide if out
        // of ammo) bracket the two Flags2 bits above; Flags3 0x0002
        // (translucent) and 0x0010 (closest exit) bracket the Flags3 ones.
        const { data } = await parse(weapFromBytes({
            guidance: UNGUIDED, flags2: 0x0200 | 0x0800, flags3: 0x0002 | 0x0010,
        }));
        expect(data.npcCantUse).toBeFalse();
        expect(data.planetType).toBeFalse();
        expect(data.fireWhileCloaked).toBeFalse();
        expect(data.cantFireUntilShotExpires).toBeFalse();
        expect(data.exclusive).toBeFalse();
        expect(data.useFiringAnimation).toBeTrue();
        expect(data.firesFromClosestToTarget).toBeTrue();
    });
});

describe("wëap Inaccuracy below zero (fires to the side by this angle)", () => {
    it("keeps the absolute angle and marks it as fixed", async () => {
        // More Blasters CHEAT:253 "Side Radar Missile" carries -90.
        const { data } = await parse(weapFromBytes({ guidance: UNGUIDED, accuracy: -90 }));
        expect(data.accuracy).toEqual(90);
        expect(data.firesAtFixedAngle).toBeTrue();
    });

    it("leaves a positive Inaccuracy as a random spread", async () => {
        const { data } = await parse(weapFromBytes({ guidance: UNGUIDED, accuracy: 5 }));
        expect(data.accuracy).toEqual(5);
        expect(data.firesAtFixedAngle).toBeFalse();
    });
});

describe("beam wëap Decay and on-screen time", () => {
    // EVN Bible (~:3416-3419, 3437-3441): with a positive Decay the beam
    // exists onscreen for Count + 16 - CoronaFalloff frames, shrinking.
    it("stock Pulse Laser shape: Count 15, Decay 100, Falloff 0 -> 31 frames onscreen",
        async () => {
            const { data } = await parse(weapFromBytes({
                guidance: BEAM, duration: 15, decay: 100, coronaFalloff: 0,
            }));
            const beam = data as BeamWeaponData;
            expect(beam.type).toEqual("BeamWeaponData");
            expect(beam.decay).toEqual(100);
            // Count is still how long the beam damages.
            expect(beam.shotDuration).toBeCloseTo(15 * 1000 / FPS, 9);
            expect(beam.onScreenDuration).toBeCloseTo(31 * 1000 / FPS, 9);
        });

    it("Autumn Petal shape: Count 1, Decay 12 -> 17 frames onscreen", async () => {
        const { data } = await parse(weapFromBytes({
            guidance: BEAM, duration: 1, decay: 12, coronaFalloff: 0,
        }));
        const beam = data as BeamWeaponData;
        expect(beam.shotDuration).toBeCloseTo(1 * 1000 / FPS, 9);
        expect(beam.onScreenDuration).toBeCloseTo(17 * 1000 / FPS, 9);
    });

    it("subtracts the corona falloff from the tail", async () => {
        // Advanced Vell-os Beams:380 shape: Count 1, Decay 16, Falloff 8 -> 9.
        const { data } = await parse(weapFromBytes({
            guidance: BEAM, duration: 1, decay: 16, coronaFalloff: 8,
        }));
        expect((data as BeamWeaponData).onScreenDuration)
            .toBeCloseTo(9 * 1000 / FPS, 9);
    });

    it("never shortens a beam below its Count (falloff past the Bible's 16 ceiling)",
        async () => {
            // extra-outfits:353 Mining Laser: Count 5, Decay 20, Falloff 60.
            const { data } = await parse(weapFromBytes({
                guidance: BEAM, duration: 5, decay: 20, coronaFalloff: 60,
            }));
            const beam = data as BeamWeaponData;
            expect(beam.onScreenDuration).toEqual(beam.shotDuration);
        });

    it("a beam without Decay lives exactly its Count", async () => {
        const { data } = await parse(weapFromBytes({
            guidance: BEAM, duration: 1, decay: 0, coronaFalloff: 4,
        }));
        const beam = data as BeamWeaponData;
        expect(beam.decay).toEqual(0);
        expect(beam.onScreenDuration).toEqual(beam.shotDuration);
        expect(beam.shotDuration).toBeCloseTo(1000 / FPS, 9);
    });

    it("clamps a negative Decay to none, like the projectile decay", async () => {
        const { data } = await parse(weapFromBytes({
            guidance: BEAM, duration: 3, decay: -1,
        }));
        const beam = data as BeamWeaponData;
        expect(beam.decay).toEqual(0);
        expect(beam.onScreenDuration).toEqual(beam.shotDuration);
    });

    it("leaves the projectile decay field alone", async () => {
        const { data } = await parse(weapFromBytes({
            guidance: UNGUIDED, duration: 30, decay: 10,
        }));
        expect((data as ProjectileWeaponData).decay).toEqual(10);
    });
});
