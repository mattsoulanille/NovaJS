import 'jasmine';
import {
    getDefaultBayWeaponData, getDefaultBeamWeaponData,
    getDefaultProjectileWeaponData, WeaponData,
} from 'novadatainterface/weapon_data';
import {
    shortestSuicideReach, shortestSuicideReachOfStates, suicideWeaponInReach,
    suicideWeaponInReachState, weaponReach,
} from './weapon_range.js';

function projectile(over: Partial<ReturnType<
    typeof getDefaultProjectileWeaponData>> = {}): WeaponData {
    const base = getDefaultProjectileWeaponData();
    return { ...base, ...over };
}

describe('weaponReach', () => {
    it('is flight distance plus the proximity fuse for a projectile', () => {
        // 45px/s for 100ms = 4.5px of flight, behind a 120px fuse: the
        // Intelligent EMP Torpedo's warhead.
        expect(weaponReach(projectile({
            shotDuration: 100, proxRadius: 120,
            physics: { ...getDefaultProjectileWeaponData().physics, speed: 45 },
        }))).toBeCloseTo(124.5, 6);
    });

    it('ignores blastRadius, which extends damage and not reach', () => {
        const near = projectile({
            shotDuration: 100, proxRadius: 120, blastRadius: 1000,
            physics: { ...getDefaultProjectileWeaponData().physics, speed: 45 },
        });
        expect(weaponReach(near)).toBeCloseTo(124.5, 6);
    });

    it('is the drawn length for a beam', () => {
        const beam = getDefaultBeamWeaponData();
        beam.beamAnimation = { ...beam.beamAnimation, length: 320 };
        expect(weaponReach(beam)).toBe(320);
    });

    it('is unbounded for a bay, which launches rather than throws', () => {
        expect(weaponReach(getDefaultBayWeaponData())).toBe(Infinity);
    });
});

describe('suicideWeaponInReach', () => {
    const suicide = projectile({
        destroyShipWhenFiring: true, shotDuration: 100, proxRadius: 120,
        physics: { ...getDefaultProjectileWeaponData().physics, speed: 45 },
    });

    it('holds a suicide weapon until the shot can connect', () => {
        expect(suicideWeaponInReach(suicide, 200 * 200)).toBeFalse();
        expect(suicideWeaponInReach(suicide, 100 * 100)).toBeTrue();
    });

    it('never restricts an ordinary weapon', () => {
        const ordinary = { ...suicide, destroyShipWhenFiring: false };
        expect(suicideWeaponInReach(ordinary, 1e9)).toBeTrue();
    });
});

describe('shortestSuicideReach', () => {
    const weapons = new Map<string, WeaponData>([
        ['short', projectile({
            id: 'short', destroyShipWhenFiring: true,
            shotDuration: 100, proxRadius: 120,
            physics: { ...getDefaultProjectileWeaponData().physics, speed: 45 },
        })],
        ['long', projectile({
            id: 'long', destroyShipWhenFiring: true,
            shotDuration: 1000, proxRadius: 0,
            physics: { ...getDefaultProjectileWeaponData().physics, speed: 500 },
        })],
        ['gun', projectile({ id: 'gun' })],
    ]);
    const get = (id: string) => weapons.get(id);

    it('picks the shortest, so every suicide weapon aboard is usable', () => {
        expect(shortestSuicideReach(['gun', 'long', 'short'], get))
            .toBeCloseTo(124.5, 6);
    });

    it('is undefined for a ship carrying no suicide weapon', () => {
        expect(shortestSuicideReach(['gun'], get)).toBeUndefined();
    });

    it('skips ids whose data is not cached yet', () => {
        expect(shortestSuicideReach(['not-loaded'], get)).toBeUndefined();
    });
});

describe('synced-state forms (never getCached at decision time)', () => {
    it('shortestSuicideReachOfStates picks the shortest suicideReach aboard', () => {
        expect(shortestSuicideReachOfStates([
            ['a', { suicideReach: 300 }],
            ['b', {}],
            ['c', { suicideReach: 124.5 }],
        ])).toBe(124.5);
    });

    it('shortestSuicideReachOfStates is undefined with no suicide weapon', () => {
        expect(shortestSuicideReachOfStates([['a', {}], ['b', {}]]))
            .toBeUndefined();
        expect(shortestSuicideReachOfStates([])).toBeUndefined();
    });

    it('shortestSuicideReachOfStates is order-independent', () => {
        const forward = shortestSuicideReachOfStates(
            [['a', { suicideReach: 5 }], ['b', { suicideReach: 2 }]]);
        const backward = shortestSuicideReachOfStates(
            [['b', { suicideReach: 2 }], ['a', { suicideReach: 5 }]]);
        expect(forward).toBe(2);
        expect(backward).toBe(2);
    });

    it('suicideWeaponInReachState holds a suicide weapon until in reach', () => {
        const state = { suicideReach: 100 };
        expect(suicideWeaponInReachState(state, 101 * 101)).toBeFalse();
        expect(suicideWeaponInReachState(state, 100 * 100)).toBeTrue();
        expect(suicideWeaponInReachState(state, 0)).toBeTrue();
    });

    it('suicideWeaponInReachState never restricts an ordinary weapon', () => {
        expect(suicideWeaponInReachState({}, Infinity)).toBeTrue();
    });
});
