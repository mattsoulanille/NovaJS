import 'jasmine';
import { canJump, jumpBlocker, jumpRadiusFor } from './jump_readiness.js';
import { FUEL_PER_JUMP } from '../ship/health_plugin.js';
import { JUMP_DISTANCE } from './jump_plugin.js';

function inputs(overrides: Partial<Parameters<typeof canJump>[0]> = {}) {
    return {
        hasRoute: true,
        distance: JUMP_DISTANCE + 1,
        jumpRadius: JUMP_DISTANCE,
        fuel: FUEL_PER_JUMP,
        fuelPerJump: FUEL_PER_JUMP,
        ...overrides,
    };
}

describe('jumpRadiusFor', () => {
    it('adds the ship\'s hyperspace dist mod to the standard radius', () => {
        expect(jumpRadiusFor(JUMP_DISTANCE, 0)).toBe(JUMP_DISTANCE);
        expect(jumpRadiusFor(JUMP_DISTANCE, 500)).toBe(JUMP_DISTANCE + 500);
        expect(jumpRadiusFor(JUMP_DISTANCE, -400)).toBe(JUMP_DISTANCE - 400);
    });

    it('floors at zero so a huge negative mod cannot invert the test', () => {
        expect(jumpRadiusFor(JUMP_DISTANCE, -100_000)).toBe(0);
    });
});

describe('jumpBlocker', () => {
    it('clears a ship with a route, outside the zone, with fuel', () => {
        expect(jumpBlocker(inputs())).toBeUndefined();
        expect(canJump(inputs())).toBeTrue();
    });

    it('names the no-route case', () => {
        expect(jumpBlocker(inputs({ hasRoute: false }))).toBe('noRoute');
    });

    it('names the no-jump zone', () => {
        expect(jumpBlocker(inputs({ distance: JUMP_DISTANCE - 1 })))
            .toBe('tooClose');
        // Exactly at the radius is allowed (the gate refuses on <, not <=).
        expect(jumpBlocker(inputs({ distance: JUMP_DISTANCE })))
            .toBeUndefined();
    });

    it('names insufficient fuel', () => {
        expect(jumpBlocker(inputs({ fuel: FUEL_PER_JUMP - 1 })))
            .toBe('noFuel');
        expect(jumpBlocker(inputs({ fuel: FUEL_PER_JUMP }))).toBeUndefined();
    });

    it('names disabled and jumping, which outrank the rest', () => {
        expect(jumpBlocker(inputs({ disabled: true }))).toBe('disabled');
        expect(jumpBlocker(inputs({ jumping: true }))).toBe('jumping');
        // A disabled ship with no route reports 'disabled': the order is the
        // simulation gate's own, so the blocker names what refused first.
        expect(jumpBlocker(inputs({ disabled: true, hasRoute: false })))
            .toBe('disabled');
    });

    it('respects a ship-specific jump radius', () => {
        const radius = jumpRadiusFor(JUMP_DISTANCE, 500);
        expect(jumpBlocker(inputs({ jumpRadius: radius, distance: 1200 })))
            .toBe('tooClose');
        expect(jumpBlocker(inputs({ jumpRadius: radius, distance: 1600 })))
            .toBeUndefined();
    });
});
