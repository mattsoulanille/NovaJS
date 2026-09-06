import 'jasmine';
import { ShipAnimationMode } from 'novadatainterface/animation';
import { foldBlocksFiring, foldRatePerSecond, moveToward } from './fold_state.js';

// The asteroid miner: 6 base sets, AnimDelay 5 -> 6 sets/second.
const minerMode: ShipAnimationMode = {
    purpose: 'folding',
    baseSetCount: 6,
    framesPer: 36,
    setsPerSecond: 6,
    unfoldWhenFiring: true,
    stopWhenDisabled: false,
    hideAltWhenDisabled: false,
    hideLightsWhenDisabled: true,
};

describe('moveToward', () => {
    it('steps up toward the target without overshooting', () => {
        expect(moveToward(0, 1, 0.3)).toBeCloseTo(0.3);
        expect(moveToward(0.9, 1, 0.3)).toBe(1); // clamps, no overshoot
    });

    it('steps down toward the target without undershooting', () => {
        expect(moveToward(1, 0, 0.3)).toBeCloseTo(0.7);
        expect(moveToward(0.1, 0, 0.3)).toBe(0); // clamps
    });

    it('is a no-op when already at the target', () => {
        expect(moveToward(1, 1, 0.3)).toBe(1);
        expect(moveToward(0, 0, 0.3)).toBe(0);
    });
});

describe('foldRatePerSecond', () => {
    it('spreads the [0,1] sweep across baseSetCount-1 set transitions', () => {
        // 6 sets at 6 sets/s -> 5 transitions -> 1.2 progress/second.
        expect(foldRatePerSecond(minerMode)).toBeCloseTo(1.2);
    });

    it('folds in one step for a degenerate single-set ship', () => {
        expect(foldRatePerSecond({ ...minerMode, baseSetCount: 1 }))
            .toBe(minerMode.setsPerSecond);
    });
});

describe('foldBlocksFiring (the miner firing gate)', () => {
    it('never blocks a ship without fold state', () => {
        expect(foldBlocksFiring(undefined)).toBe(false);
    });

    it('blocks while the claws are still wrapping (progress < 1)', () => {
        expect(foldBlocksFiring({ progress: 0 })).toBe(true);
        expect(foldBlocksFiring({ progress: 0.5 })).toBe(true);
        expect(foldBlocksFiring({ progress: 0.999 })).toBe(true);
    });

    it('allows fire exactly when fully unfolded', () => {
        expect(foldBlocksFiring({ progress: 1 })).toBe(false);
    });
});

describe('fold advance simulation', () => {
    // Reproduce FoldAdvanceSystem's per-tick arithmetic deterministically.
    function advance(progress: number, wantsToFire: boolean, deltaS: number) {
        return moveToward(progress, wantsToFire ? 1 : 0,
            foldRatePerSecond(minerMode) * deltaS);
    }

    it('opens the claws over time while firing, reaching fully unfolded', () => {
        let p = 0;
        // 1.2/s means ~0.83s to fully unfold; 60 ticks of 1/60s = 1s.
        for (let i = 0; i < 60; i++) {
            p = advance(p, true, 1 / 60);
        }
        expect(p).toBe(1);
    });

    it('re-wraps the claws when firing stops', () => {
        let p = 1;
        for (let i = 0; i < 60; i++) {
            p = advance(p, false, 1 / 60);
        }
        expect(p).toBe(0);
    });

    it('is deterministic: identical inputs give identical progress', () => {
        const run = () => {
            let p = 0;
            for (let i = 0; i < 20; i++) {
                p = advance(p, true, 1 / 60);
            }
            return p;
        };
        expect(run()).toBe(run());
    });
});
