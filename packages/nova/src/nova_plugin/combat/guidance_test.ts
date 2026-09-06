import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import {
    guidanceAngle,
    MissileGuidanceMode,
    zeroOrderGuidance,
    firstOrderGuidance,
    firstOrderWithFallback,
} from './guidance.js';

// The coordinate system used by Vector.angle is atan2(x, -y): a vector
// pointing in +y is "down" (angle = pi), pointing in -y is "up" (angle = 0),
// and pointing in +x is angle = pi/2.

describe('guidanceAngle', () => {
    // Missile at the origin. Target sitting directly "up" the screen,
    // moving to the right (+x) so a leading solution aims ahead of it.
    const missilePos = new Position(0, 0);
    const missileVel = new Vector(0, 0);
    const targetPos = new Position(0, -100);
    const targetVel = new Vector(50, 0); // moving in +x
    const shotSpeed = 200;

    describe('simple mode', () => {
        it('points straight at the target current position, ignoring its velocity', () => {
            const stationary = guidanceAngle(MissileGuidanceMode.simple,
                missilePos, missileVel, targetPos, new Vector(0, 0), shotSpeed);
            const moving = guidanceAngle(MissileGuidanceMode.simple,
                missilePos, missileVel, targetPos, targetVel, shotSpeed);

            // Target is straight up (-y), which is angle 0.
            expect(stationary).toEqual(new Angle(0));
            // The target's velocity must not change the aim: simple never leads.
            expect(moving).toEqual(stationary);
        });

        it('is exactly zeroOrderGuidance (point at current position)', () => {
            const actual = guidanceAngle(MissileGuidanceMode.simple,
                missilePos, missileVel, targetPos, targetVel, shotSpeed);
            expect(actual).toEqual(zeroOrderGuidance(missilePos, targetPos));
        });

        it('is deterministic: same inputs give the same angle', () => {
            const a = guidanceAngle(MissileGuidanceMode.simple,
                missilePos, missileVel, targetPos, targetVel, shotSpeed);
            const b = guidanceAngle(MissileGuidanceMode.simple,
                missilePos, missileVel, targetPos, targetVel, shotSpeed);
            expect(a).toEqual(b);
        });
    });

    describe('smart mode', () => {
        it('leads a moving target (aims to the +x side of its current position)', () => {
            const actual = guidanceAngle(MissileGuidanceMode.smart,
                missilePos, missileVel, targetPos, targetVel, shotSpeed);

            // Straight-up is angle 0. Because the target moves in +x and +x is
            // a positive angle (atan2(x, -y)), leading it means aiming at a
            // strictly positive angle.
            expect(actual.angle).toBeGreaterThan(0);
        });

        it('matches firstOrderWithFallback (the original steering)', () => {
            const actual = guidanceAngle(MissileGuidanceMode.smart,
                missilePos, missileVel, targetPos, targetVel, shotSpeed);
            expect(actual).toEqual(firstOrderWithFallback(missilePos, missileVel,
                targetPos, targetVel, shotSpeed));
        });

        it('falls back to point-at-current-position for a stationary target', () => {
            const actual = guidanceAngle(MissileGuidanceMode.smart,
                missilePos, missileVel, targetPos, new Vector(0, 0), shotSpeed);
            // Nothing to lead, so it should point straight at the target.
            expect(actual).toEqual(new Angle(0));
        });

        it('is deterministic: same inputs give the same angle', () => {
            const a = guidanceAngle(MissileGuidanceMode.smart,
                missilePos, missileVel, targetPos, targetVel, shotSpeed);
            const b = guidanceAngle(MissileGuidanceMode.smart,
                missilePos, missileVel, targetPos, targetVel, shotSpeed);
            expect(a).toEqual(b);
        });
    });

    describe('degenerate intercepts (firstOrderGuidance)', () => {
        // Relative speed EXACTLY the shot speed makes the quadratic's
        // leading coefficient zero. The general formula divides by it.
        it('solves the linear case for a target closing head-on at shot speed', () => {
            // Target straight up, coming straight down at shotSpeed.
            const solutions = firstOrderGuidance(missilePos, missileVel,
                targetPos, new Vector(0, shotSpeed), shotSpeed);
            expect(solutions.length).toBe(1);
            expect(Number.isFinite(solutions[0].angle)).toBeTrue();
            // They meet on the line between them: aim straight up.
            expect(solutions[0].angle).toBeCloseTo(0, 10);
        });

        it('finds no intercept for a target fleeing straight away at shot speed', () => {
            const solutions = firstOrderGuidance(missilePos, missileVel,
                targetPos, new Vector(0, -shotSpeed), shotSpeed);
            expect(solutions).toEqual([]);
        });

        it('never yields a NaN angle in the linear case', () => {
            const angle = firstOrderWithFallback(missilePos, missileVel,
                targetPos, new Vector(0, shotSpeed), shotSpeed);
            expect(Number.isNaN(angle.angle)).toBeFalse();
        });

        it('has no solution for a shot that does not move', () => {
            expect(firstOrderGuidance(missilePos, missileVel, targetPos,
                targetVel, 0)).toEqual([]);
            // ...and the fallback points at the target rather than NaN.
            const angle = firstOrderWithFallback(missilePos, missileVel,
                targetPos, targetVel, 0);
            expect(angle).toEqual(zeroOrderGuidance(missilePos, targetPos));
        });
    });

    it('the two modes disagree for a moving target (smart leads, simple does not)', () => {
        const smart = guidanceAngle(MissileGuidanceMode.smart,
            missilePos, missileVel, targetPos, targetVel, shotSpeed);
        const simple = guidanceAngle(MissileGuidanceMode.simple,
            missilePos, missileVel, targetPos, targetVel, shotSpeed);
        expect(smart).not.toEqual(simple);
        // Simple points at the target now; smart aims ahead of it.
        expect(simple.angle).toEqual(0);
        expect(smart.angle).toBeGreaterThan(simple.angle);
    });
});
