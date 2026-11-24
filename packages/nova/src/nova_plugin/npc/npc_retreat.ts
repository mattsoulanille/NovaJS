import { Random } from 'nova_ecs/plugins/random_plugin';
import { NpcState } from './npc_component.js';

/**
 * gövt Flags 0x0010, "Warships of this govt will retreat when their
 * shields drop below 25%" — what that means on the original, as measured
 * (docs/reference_experiments.md: "A-series wave 3", "A-series wave 4: AI
 * 1 departure, gövt 0x0010 retreat", "A-series wave 5", "A wave 6" and "A
 * wave 7: gövt 0x0010, distance and damage rate at the 25% crossing"):
 *
 *  - the shield level alone does NOT trigger it. Against one weak gun the
 *    flagged tank fought on with shields down in 5 of 6 runs;
 *  - heavy fire, or an attacker its MaxOdds call too strong, does. Then it
 *    either JUMPED OUT or STOOD OFF (a few hundred px from the attacker,
 *    still firing) for as long as the fire lasted, coming back to close
 *    passes within a few seconds of it stopping. It never landed;
 *  - which of the two is decided neither by the distance at the crossing
 *    nor by the damage rate (wave 7: 4 of 12 jumped, crossings from 25 px
 *    to 1320 px, two damage rates). Every jump was decided AT the crossing
 *    (the jumper turned away within seconds and was gone 18-24 s later),
 *    and no tank that stayed jumped later, under up to 50 s more fire
 *    (waves 4-6: stand-offs lasted the whole 85 s of fire).
 *
 * The rule here: a flagged warship whose shield is under 25% and which
 * is LOSING — under heavy fire (the damage-load bucket below over its
 * threshold) or facing a fight its MaxOdds call unfavorable — makes ONE
 * PRNG draw the first time that holds (NpcState `retreatJump`, synced).
 * With RETREAT_JUMP_CHANCE_FITTED it flees at once, which ends in a
 * hyperspace jump (departByJump); otherwise it stands off from its enemy
 * (npc_steering.ts's steerStandoff; still in 'attack', so it keeps firing
 * whatever reaches) for as long as it is losing, and never jumps for it.
 * As soon as it stops losing it resumes attacking. Flag-less ships never
 * get here.
 *
 * ONE DRAW PER CROSSING. The draw is kept while the shield stays under
 * 25%, through any number of stand-off / fight-on cycles (the original's
 * tanks stood off, came back to fight and stood off again without a late
 * jump); it is dropped, so the next losing spell draws afresh, only once
 * the shield is back at or above 25% and then crosses again.
 *
 * The thresholds below are guesses fitted to the doc's tables; the jump
 * chance is fitted to its counts. Determinism: synced NpcState fields,
 * the sim clock and the seeded RandomResource only.
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
/**
 * The chance that a flagged warship, when it first starts losing below
 * 25% shield, jumps out rather than standing off. FITTED to the counts of
 * every reference run in which the retreat condition held: 13 of 28
 * jumped. Wave 7's twelve: 4. Waves 4-6's sixteen heavy-fire or
 * strong-attacker runs: 9 (4 guns 2 of 4, two attacking escorts 2 of 2,
 * a Strength-10000 attacker 2 of 2, a Strength-1 attacker with 4 guns 1
 * of 2, a 13 s burst 1 of 2, 8 guns 0 of 2, the long beam 1 of 2). Wave 7
 * alone, the cleanest design, would give 1 in 3; the pooled share is the
 * fit.
 */
export const RETREAT_JUMP_CHANCE_FITTED = 13 / 28;
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
 * losing, and fights on normally once it is not. (It still makes and
 * keeps its draw, so a hold released while it is losing acts on it.)
 *
 * Maintains `retreatSince` (cleared whenever it stops losing),
 * `retreatJump` (the draw: made the first think the condition holds,
 * dropped only once the shield is back at or above 25%), and drops a
 * drained damage-load bucket. Exactly one `random` draw per crossing, on
 * the think the condition first holds; none on any other think.
 */
export function warshipRetreat(npc: NpcState,
    shield: { current: number, max: number } | undefined, now: number,
    hasThreat: boolean, favorable: boolean, random: Random,
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
    if (!weak) {
        // Back at or over 25% (or no shield at all): the next crossing
        // draws afresh.
        delete npc.retreatJump;
    }
    const losing = weak
        && (load > HEAVY_FIRE_LOAD || (hasThreat && !favorable));
    if (!losing) {
        delete npc.retreatSince;
        return undefined;
    }
    npc.retreatSince ??= now;
    // The one draw of this crossing (wave 7: decided at the crossing).
    npc.retreatJump ??= random.next() < RETREAT_JUMP_CHANCE_FITTED;
    if (!hasThreat) {
        // Hit hard by something it cannot target (cloaked, say): nothing
        // to stand off from, so it runs whatever the draw said (a held
        // ship can only carry on).
        return canLeave ? 'jump' : undefined;
    }
    if (canLeave && npc.retreatJump) {
        return 'jump';
    }
    return 'standoff';
}
