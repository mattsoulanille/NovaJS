import * as t from 'io-ts';
import { Component } from 'nova_ecs/component';
import { ShipAnimationMode } from 'novadatainterface/animation';

/**
 * Deterministic simulation state for a folding ship that unfolds to fire
 * (shän Flags 0x0002 + 0x0080 — the asteroid miner's claws). `progress`
 * runs [0, 1]: 0 fully folded (claws wrapped, cannot fire), 1 fully
 * unfolded (claws open, may fire). It advances toward 1 while the ship
 * intends to fire and toward 0 when idle (FoldAdvanceSystem), and it
 * GATES weapon fire (WeaponsSystem) — hence it is real sim state, not a
 * display effect: every peer must agree on whether a shot is allowed.
 *
 * Only ships whose animationMode has `unfoldWhenFiring` carry this
 * component; its mere presence with progress < 1 blocks firing. Jump
 * folding (the Argosy) is display-only and uses AnimationGraphic.foldProgress
 * instead — it gates nothing.
 */
export const FoldStateType = t.type({
    /** Fold animation progress, 0 (folded) .. 1 (unfolded). */
    progress: t.number,
});
export type FoldState = t.TypeOf<typeof FoldStateType>;
export const FoldStateComponent = new Component<FoldState>('FoldState');

/** A ship is fully unfolded (claws open) at this progress; firing is
 * allowed only at or above it. */
export const FOLD_UNFOLDED = 1;

/**
 * Whether a folding ship's claws are still wrapped enough to block weapon
 * fire. A ship with no FoldStateComponent (i.e. not an unfold-to-fire
 * ship) never blocks. Used by WeaponsSystem's miner firing gate.
 */
export function foldBlocksFiring(fold: FoldState | undefined): boolean {
    return fold !== undefined && fold.progress < FOLD_UNFOLDED;
}

/**
 * Fold progress advanced per second: one full fold sweep traverses
 * baseSetCount - 1 set transitions at setsPerSecond sets/second, so the
 * [0,1] progress moves at setsPerSecond / (baseSetCount - 1) per second.
 * A single-set ship (degenerate) folds in one tick.
 */
export function foldRatePerSecond(mode: ShipAnimationMode): number {
    return mode.baseSetCount > 1
        ? mode.setsPerSecond / (mode.baseSetCount - 1)
        : mode.setsPerSecond;
}

/** Moves `value` toward `target` by at most `step` (>= 0), clamped so it
 * never overshoots. */
export function moveToward(value: number, target: number, step: number): number {
    if (value < target) {
        return Math.min(target, value + step);
    }
    return Math.max(target, value - step);
}
