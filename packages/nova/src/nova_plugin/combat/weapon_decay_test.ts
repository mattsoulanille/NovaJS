import 'jasmine';
import { ProjectileWeaponData, WeaponDamage } from 'novadatainterface/weapon_data';
import { decayDamage } from './projectile_plugin.js';
import { getIntegrationGameData } from '../../communication/simulation_test_fixture.js';

// A damage payload with distinct, easy-to-track values in every field so a
// test can tell which one (if any) a decay step touched.
function baseDamage(over: Partial<WeaponDamage> = {}): WeaponDamage {
    return {
        shield: 100,
        armor: 100,
        ionization: 7,
        ionizationColor: 0x112233,
        passThroughShield: 0,
        knockback: 9,
        disableOnly: false,
        ...over,
    };
}

// 1 frame = 1/30 sec, the rate the EVN Bible's Decay field counts in and
// the same factor the sim uses (30/1000) to turn ms into frames.
const FRAME_MS = 1000 / 30;

describe('decayDamage', () => {
    it('leaves damage unchanged when decay is 0 (no decay)', () => {
        const d = baseDamage({ shield: 5, armor: 10 });
        // 0 means "Ignored" per the Bible; the payload is returned as-is.
        expect(decayDamage(d, 0, 1000)).toBe(d);
    });

    it('leaves damage unchanged when decay is negative', () => {
        const d = baseDamage({ shield: 5, armor: 10 });
        // The parser clamps -1 to 0, but the helper must be robust to a
        // negative value too (the Bible treats -1 and 0 identically).
        expect(decayDamage(d, -1, 1000)).toBe(d);
    });

    it('treats a missing/NaN decay as no decay (deserialization safety)', () => {
        const d = baseDamage({ shield: 5, armor: 10 });
        // The ProjectileData codec is a passthrough, so a snapshot from
        // before this field existed could carry undefined; a NaN must
        // never reach the damage math or it would desync the sim.
        expect(decayDamage(d, undefined as unknown as number, 1000)).toBe(d);
        expect(decayDamage(d, NaN, 1000)).toBe(d);
    });

    it('loses no damage before the first decay interval elapses', () => {
        const d = baseDamage({ shield: 5, armor: 10 });
        // 24 frames flown, decay every 25 frames: nothing lost yet.
        expect(decayDamage(d, 25, 24 * FRAME_MS)).toBe(d);
    });

    it('removes one point of shield & armor per decay interval of flight', () => {
        const d = baseDamage({ shield: 5, armor: 10 });
        // Exactly 25 frames: one point of each lost (5/10 -> 4/9).
        const after25 = decayDamage(d, 25, 25 * FRAME_MS);
        expect(after25.shield).toEqual(4);
        expect(after25.armor).toEqual(9);
        // 50 frames: two points of each lost (5/10 -> 3/8).
        const after50 = decayDamage(d, 25, 50 * FRAME_MS);
        expect(after50.shield).toEqual(3);
        expect(after50.armor).toEqual(8);
    });

    it('clamps shield and armor at zero (never goes negative)', () => {
        const d = baseDamage({ shield: 2, armor: 1 });
        // 100 frames, decay every 10 frames: would shed 10 of each.
        const after = decayDamage(d, 10, 100 * FRAME_MS);
        expect(after.shield).toEqual(0);
        expect(after.armor).toEqual(0);
    });

    it('reduces only mass & energy damage (ionization/knockback untouched)', () => {
        const d = baseDamage({
            shield: 5, armor: 10,
            ionization: 7, knockback: 9,
            passThroughShield: 1, disableOnly: true,
        });
        const after = decayDamage(d, 25, 50 * FRAME_MS);
        // The Bible names only "mass & energy damage"; everything else
        // is carried through unchanged.
        expect(after.shield).toEqual(3);
        expect(after.armor).toEqual(8);
        expect(after.ionization).toEqual(7);
        expect(after.ionizationColor).toEqual(0x112233);
        expect(after.knockback).toEqual(9);
        expect(after.passThroughShield).toEqual(1);
        expect(after.disableOnly).toBe(true);
    });
});

// Pin the decay semantics on the real Fusion Pulse Cannon — the stock weapon
// the EVN Bible's Decay field was built for. Runs against the real Nova game
// data (Nova_Data): wëap 143 -> WeapResource -> WeaponParse ->
// ProjectileWeaponData.decay, then through decayDamage.
describe('Fusion Pulse Cannon decay (real Nova data)', () => {
    let fpc: ProjectileWeaponData;

    beforeEach(async () => {
        const gameData = await getIntegrationGameData();
        const weapon = await gameData.data.Weapon.get('nova:143');
        expect(weapon.type).toEqual('ProjectileWeaponData');
        fpc = weapon as ProjectileWeaponData;
    });

    it('is the Fusion Pulse Cannon and parses a nonzero decay', () => {
        // Guard the id: if nova:143 ever stops being the FPC, the name
        // check fails loudly instead of asserting a wrong decay.
        expect(fpc.name).toEqual('Fusion Pulse Cannon');
        expect(fpc.decay).toEqual(25);
        expect(fpc.damage.shield).toEqual(5);
        expect(fpc.damage.armor).toEqual(10);
        // The FPC carries a blast radius, so decay must reach the blast
        // payload too (see ProjectileBlastSystem), not just the direct hit.
        expect(fpc.blastRadius).toEqual(20);
    });

    it('loses one point of damage per 25 frames of flight', () => {
        // Half a lifetime (25 of its 50 frames): 5/10 -> 4/9.
        const at25 = decayDamage(fpc.damage, fpc.decay, 25 * FRAME_MS);
        expect(at25.shield).toEqual(4);
        expect(at25.armor).toEqual(9);
        // A full 50-frame lifetime: 5/10 -> 3/8 (the FPC's max decay).
        const at50 = decayDamage(fpc.damage, fpc.decay, 50 * FRAME_MS);
        expect(at50.shield).toEqual(3);
        expect(at50.armor).toEqual(8);
    });
});
