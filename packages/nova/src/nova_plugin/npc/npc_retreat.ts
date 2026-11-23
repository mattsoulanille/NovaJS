import { NpcState } from './npc_component.js';

/**
 * gövt Flags 0x0010, "Warships of this govt will retreat when their
 * shields drop below 25%" — what that means on the original, as measured
 * (docs/reference_experiments.md, "A-series wave 3" and "A-series wave 4:
 * AI 1 departure, gövt 0x0010 retreat"):
 *
 *  - the shield level alone does NOT trigger it. Against one weak gun the
 *    flagged tank fought on with shields down in 5 of 6 runs;
 *  - heavy fire does. Against 4 guns, or with two attacking escorts, it
 *    never fought on: it either STOOD OFF 360-420 px (still firing) for
 *    as long as the fire lasted and came straight back to close passes
 *    within about 4 s of it stopping, or JUMPED OUT about 16-17 s after
 *    its shield crossed 25%. It never landed.
 *
 * The rule here: a flagged warship whose shield is under 25% and which
 * is LOSING — under heavy fire (the damage-load bucket below over its
 * threshold) or facing a fight its MaxOdds call unfavorable — stands off
 * from its enemy (npc_steering.ts's steerStandoff; still in 'attack', so
 * it keeps firing whatever reaches). If that lasts RETREAT_JUMP_MS it
 * flees, which ends in a hyperspace jump (departByJump). As soon as it
 * stops losing it resumes attacking. Flag-less ships never get here.
 *
 * EVERY THRESHOLD BELOW IS A GUESS fitted to the doc's tables; the
 * original's exact rule was not pinned down (a per-decision random chance
 * could not be ruled out). Determinism: synced NpcState fields and the sim
 * clock only, plain arithmetic, no PRNG draw.
 */

/** Bible: "...when their shields drop below 25%". */
export const RETREAT_SHIELD_FRACTION = 0.25;

/**
 * The damage rate, in fractions of the ship's max shield per second, the
 * bucket drains at; sustained fire above it fills the bucket. A guess
 * between the doc's rates: one Kit Escort Gun took the 1000-shield tank
 * down about 4.5%/s (it fought on, 5 of 6 runs); four guns 8.5-12%/s and
 * the two escorts more than 9%/s (it always retreated).
 */
export const HEAVY_FIRE_RATE_PER_S = 0.06;
/** Bucket level (fractions of max shield) above which the ship counts as
 * under heavy fire. A guess: at the 4-gun rate it trips in 2-4 s; one
 * gun's single shots (3% each) never get near it. */
export const HEAVY_FIRE_LOAD = 0.10;
/** Seconds the bucket takes to drain from full to below HEAVY_FIRE_LOAD
 * once the firing stops. The doc: back to close passes "within 4 s of the
 * player releasing the trigger". A guess fitted to that. */
export const HEAVY_FIRE_RESUME_S = 4;
/** The bucket's ceiling, so a long barrage does not take minutes to
 * forgive (derived from the two guesses above). */
export const HEAVY_FIRE_LOAD_CAP =
    HEAVY_FIRE_LOAD + HEAVY_FIRE_RATE_PER_S * HEAVY_FIRE_RESUME_S;
/** How long a flagged warship stays losing before it jumps out. A guess
 * from the doc: the jumps came 16-17 s after the shield crossed 25%
 * (three runs; 26.5 s and 92 s with escorts). */
export const RETREAT_JUMP_MS = 16_000;
/** The stand-off band, px from the enemy: "stood off 360-420 px from the
 * player (still firing)". It stands in for "just outside the attacker's
 * weapon range"; the experiments never varied that range, so it is a
 * constant fitted to the table rather than read off the attacker's guns. */
export const RETREAT_STANDOFF_MIN = 360;
export const RETREAT_STANDOFF_MAX = 420;
/** Below this speed (px/s) a ship inside the stand-off band counts as
 * holding station and turns to face its enemy. A steering tuning value,
 * not a measurement: at 100 the spec's tank drifted 290-420 px, at 20 it
 * crept inward too slowly to correct; 40 holds 390-420. */
export const RETREAT_STANDOFF_HOLD_SPEED = 40;

const LEAK_PER_MS = HEAVY_FIRE_RATE_PER_S / 1000;

/** The damage-load bucket's level at `now` (drained since its last
 * update). Zero for a ship that has none. */
export function damageLoadNow(npc: Pick<NpcState, 'damageLoad' | 'damageLoadAt'>,
    now: number): number {
    if (npc.damageLoad === undefined || npc.damageLoadAt === undefined) {
        return 0;
    }
    return Math.max(0,
        npc.damageLoad - LEAK_PER_MS * Math.max(0, now - npc.damageLoadAt));
}

/** Adds one hit, `fraction` of the ship's max shield, to the bucket. */
export function addDamageLoad(npc: NpcState, fraction: number, now: number) {
    npc.damageLoad = Math.min(HEAVY_FIRE_LOAD_CAP,
        damageLoadNow(npc, now) + Math.max(0, fraction));
    npc.damageLoadAt = now;
}

/** Whether a ship is under heavy fire at `now`. */
export function underHeavyFire(npc: NpcState, now: number): boolean {
    return damageLoadNow(npc, now) > HEAVY_FIRE_LOAD;
}

/**
 * One think of the 0x0010 retreat for a flagged warship. Returns
 *  - 'jump': flee (and so jump out); committed once chosen;
 *  - 'standoff': keep attacking `threat` from the stand-off band;
 *  - undefined: not losing, so the ordinary warship logic decides.
 *
 * `hasThreat` is whether the warship has an enemy to fight (its chosen
 * target), `favorable` whether its MaxOdds call that fight favorable.
 * `canLeave` is false for a ship HELD in the system (system_hold.ts: a
 * mission goal ship). It can never jump out, so it never commits to a
 * flee it could not finish: it keeps standing off for as long as it is
 * losing, and fights on normally once it is not.
 * Maintains `retreatSince` and drops a drained damage-load bucket.
 */
export function warshipRetreat(npc: NpcState,
    shield: { current: number, max: number } | undefined, now: number,
    hasThreat: boolean, favorable: boolean,
    canLeave = true): 'jump' | 'standoff' | undefined {
    const load = damageLoadNow(npc, now);
    if (load <= 0) {
        // Drained: nothing rides in the snapshot for a ship left alone.
        delete npc.damageLoad;
        delete npc.damageLoadAt;
    }
    if (canLeave && npc.mode === 'flee' && npc.retreatSince !== undefined) {
        // Decided to go: the original never came back from a retreat jump.
        return 'jump';
    }
    const weak = shield !== undefined && shield.max > 0
        && shield.current < RETREAT_SHIELD_FRACTION * shield.max;
    const losing = weak
        && (load > HEAVY_FIRE_LOAD || (hasThreat && !favorable));
    if (!losing) {
        delete npc.retreatSince;
        return undefined;
    }
    npc.retreatSince ??= now;
    if (!hasThreat) {
        // Hit hard by something it cannot target (cloaked, say): nothing
        // to stand off from, so it runs (a held ship can only carry on).
        return canLeave ? 'jump' : undefined;
    }
    if (canLeave && now - npc.retreatSince >= RETREAT_JUMP_MS) {
        return 'jump';
    }
    return 'standoff';
}
