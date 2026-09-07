/**
 * Pure edge-trigger helpers for the local UI/space sounds. Each takes the
 * previous tracked state plus this tick's inputs and returns whether the
 * sound should fire and the next state to store. Kept pure (no world, no
 * audio) so the edge semantics are unit-testable in isolation.
 */

import { canJump, JumpReadinessInputs } from '../nova_plugin/travel/index.js';

/** A target selection changed to a new, non-empty target this tick. */
export function targetChangedEdge(prev: string | undefined,
    cur: string | undefined): { beep: boolean; next: string | undefined } {
    return { beep: cur !== undefined && cur !== prev, next: cur };
}

/** A boolean condition (e.g. your ship disabled) rose false -> true. */
export function risingEdge(prev: boolean, cur: boolean):
    { beep: boolean; next: boolean } {
    return { beep: cur && !prev, next: cur };
}

/**
 * First-hostile: fire when at least one ship is hostile to you AND none was
 * hostile the previous tick (empty -> non-empty edge). Re-arms whenever the
 * hostile set empties again.
 */
export function firstHostileEdge(prevAny: boolean, anyHostile: boolean):
    { beep: boolean; next: boolean } {
    return { beep: anyHostile && !prevAny, next: anyHostile };
}

/**
 * The jump-ready cue's inputs: the shared readiness predicate's inputs
 * (jump_readiness.ts — the SAME conditions PlayerJumpControl gates on) plus
 * the route head, which only this edge needs for re-arming.
 */
export interface JumpReadyInputs extends JumpReadinessInputs {
    /** The next hop (route[0]); used to re-arm when the route changes. */
    routeHead: string | undefined;
}

export interface JumpReadyState {
    eligible: boolean;
    routeHead: string | undefined;
}

export function initialJumpReadyState(): JumpReadyState {
    return { eligible: false, routeHead: undefined };
}

/**
 * Jump-ready: fire the moment jump eligibility flips true. Eligibility is
 * NOT re-derived here — it is `canJump`, the same predicate the simulation's
 * jump gate uses (jump_readiness.ts), so the cue cannot promise a jump the
 * gate would refuse.
 *
 * The edge is re-armed both when eligibility drops back to false and when the
 * selected route's next hop changes (picking a new destination while already
 * far enough out should re-announce readiness), so a held-eligible state
 * doesn't keep re-beeping but a fresh reason to be ready does. Passing the
 * `jumping` input is what stops that re-arm from mis-firing DURING a jump:
 * beginJump shifts the route the instant a jump starts, so the route head
 * changes while the ship is mid-sequence — but a ship already jumping is not
 * "ready to jump", so no beep.
 */
export function jumpReadyEdge(prev: JumpReadyState, cur: JumpReadyInputs):
    { beep: boolean; next: JumpReadyState } {
    const eligible = canJump(cur);
    const wasEligible = prev.eligible && prev.routeHead === cur.routeHead;
    return {
        beep: eligible && !wasEligible,
        next: { eligible, routeHead: cur.routeHead },
    };
}
