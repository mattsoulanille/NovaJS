import { ShipAIFlags } from 'novadatainterface/ship_data';
import { Entities } from 'nova_ecs/arg_types';
import { Optional } from 'nova_ecs/optional';
import {
    MovementPhysicsComponent, MovementSystem,
} from 'nova_ecs/plugins/movement_plugin';
import { System } from 'nova_ecs/system';
import { EscortCommandComponent } from '../player/index.js';
import { CombatRatingComponent } from '../reputation/index.js';
import {
    DisabledComponent, getShipMovementPhysics, IonizationComponent,
    ionSlowdown,
    ShipDataComponent, ShipPhysicsComponent, TargetComponent,
} from '../ship/index.js';
import { EffectiveMovementPhysicsSystem, GravitySystem, JumpComponent } from '../travel/index.js';
import { NpcComponent, NpcState } from './npc_component.js';

/**
 * ============================================================================
 * AI afterburner (shïp Flags 0x0040)
 * ============================================================================
 *
 * EVN Bible, shïp Flags 0x0040: "Ship always has afterburner (for AIs
 * only)". 67 stock hulls. The Bible says nothing about WHEN an AI burns it.
 *
 * Reference "W1 / C1 / H1 wave 15" (docs/reference_experiments.md; the
 * frame-by-frame track of the magenta hull in that run's recording): the
 * hull with the flag and NO afterburner outfit, attacking a passive player,
 *  - made strafing runs: it accelerated from a stop 200-360 px out, flew
 *    through the player at about 5.6 px a frame and coasted out to about
 *    350 px before turning back, every run, where the identical hull
 *    without the flag topped out at about 3.5. That is 1.6x the top speed
 *    (AI_AFTERBURNER_FACTOR);
 *  - never went over its ordinary top speed while it hung within about
 *    140 px of the player (its first 36 s).
 *
 * Reference "W1 / C1 / H1 wave 16" (the same hull, a second run): its
 * MEDIAN speed was 5.3 px a frame, 1.9x the control's 2.8, and its 90th
 * percentile 5.7 — it flew at about the boosted top speed most of the run,
 * ranging wide (median 223 px from the player), not only on the closing leg
 * of a run.
 *
 * Here: an NPC of such a hull burns for as long as it is ATTACKING
 * (NpcSteeringSystem 'attack'), thrusting or coasting: its top speed stays
 * raised the whole engagement, so it closes, passes through and swings
 * back at the boosted speed, and its thrust is boosted whenever it thrusts.
 * Wave 15's first-pass rule (burn only while thrusting at the target,
 * beyond the stand-off) let the boost bleed off on every coast and could
 * not give wave 16's median.
 *
 * Reference "Contraband / W1 / C1, wave 18" (ONE such hull alone in its
 * system, 7,651 frame pairs) MEASURED the rest: it burns through its whole
 * attack, close passes included (97% of frames boosted within 50 px, 100%
 * at 50-250 px), slow only where it turns round about 340-360 px out. So
 * wave 15's slow first 36 s was two magenta hulls confused, not a close-in
 * turning fight, and the whole-attack burn here matches. (The original's
 * attack geometry, passes through the target out to about 350 px and back,
 * is not NovaJS's 250 px stand-off coast: a separate gap.)
 * NpcAfterburnerSystem applies the boost on top of what travel's
 * EffectiveMovementPhysicsSystem wrote this tick.
 *
 * GUESSES (docs/npc_behavior_gaps.md W1): whether it also burns to flee,
 * travel or close on a non-combat goal (not measured: the rule leaves those
 * alone); that it costs no fuel (the hull carries no afterburner outfit, so
 * there is no ModType 15 burn rate); that acceleration is boosted by the
 * same factor as top speed, as the player's afterburner's is. A ship in
 * the gövt 0x0010 stand-off (npc_retreat.ts) does not burn. Player-
 * commanded escorts never do: their brain is the escort command.
 */

/**
 * ============================================================================
 * AI afterburner at an advanced combat rating (shïp Flags 0x0020)
 * ============================================================================
 *
 * EVN Bible, shïp Flags 0x0020: "Ship has afterburner when player has an
 * advanced combat rating". MEASURED (reference "The Flags 0x0020
 * afterburner (A13's other half), wave 42"): a hostile AI 3 hull with the
 * flag (and no outfit) never burned against a rating-0 player (median 2.4
 * px a frame, a plain hull's) and burned the whole fight against a
 * 1,000,000 one (median 4.8, the 0x0040 hull's speed, ranging wider);
 * from 1,600 up it burned at least part of the time, in spells of 20-30
 * s, the share growing with the rating (1,600: 2 of 8 ten-second windows,
 * 3,200: 1 of 6, 6,400 / 25,600: all, 12,800: 4 of 7).
 *
 * Reference "The Flags 0x0020 burn with longer runs (A13 leftover), wave
 * 44" re-ran it for 4 minutes a rating: a STEP, not spells. Against 800
 * (and 1,200, 2 minutes) the hull never burned in any 10 s window;
 * against 1,599, 1,600, 3,200 and 12,800 it burned in every one. Wave
 * 42's partial spells did not recur (GUESS: its windows were read with a
 * cut the burning hull's own medians straddle). The edge is between 1,200
 * and 1,599, not Appendix I's 1,600 tier boundary (1,599 burned). Wave 45
 * narrowed it to 1,301-1,400 (1,300 never, 1,400 always), and reference
 * "The Flags 0x0020 burn's rating edge (A13 leftover), wave 46" to
 * 1,326-1,333: 1,325 never drew a burn in 165 s, 1,333 burned at once and
 * throughout (so not 4,000 / 3, "from 1,334"), 1,334 and 1,350 burned too
 * (1,334 after a 30 s lull: spells above the edge, unmodelled). Wave 47
 * ("... rating edge (A13 leftover), wave 47") put it to the point: 1,329
 * and 1,331 never drew a burn in 175 s, 1,332 did (with a 25 s lull, the
 * spells again), so the edge is exactly 1,332 (one point under 4,000 / 3).
 *
 * So the 0x0040 burn (the same factor, the same attack-only rule) gated
 * by the rating of the player it is ATTACKING (GUESS for multiplayer: its
 * own target's pilot, not the room's best) being at least
 * ADVANCED_RATING_BURN_MIN (1,332, measured; was the GUESS 1,330, and
 * 1,400 before that). A target with no combat rating (an NPC, a player's escort
 * or fighter) counts as 0 (GUESS: only a player was measured). Was
 * rating / 6,400 odds per 25 s spell (wave 42's proposal).
 */
export const ADVANCED_RATING_BURN_MIN = 1332;

/**
 * Whether a Flags 0x0020 hull burns against a player of combat rating
 * `rating` (kill points): a step at ADVANCED_RATING_BURN_MIN. Pure.
 */
export function advancedRatingBurns(rating: number): boolean {
    return rating >= ADVANCED_RATING_BURN_MIN;
}

/** How much the AI afterburner multiplies top speed and acceleration.
 * Measured (reference W1 wave 15): 5.6 vs 3.5 px a frame, same hull. */
export const AI_AFTERBURNER_FACTOR = 1.6;

/**
 * Whether this NPC burns its AI afterburner this tick: the whole time it is
 * attacking (thrusting or coasting), never while a player's escort command
 * drives it or while it holds a gövt 0x0010 stand-off. A Flags 0x0040 hull
 * always; a Flags 0x0020 hull when `advancedRatingBurn` (its target's
 * rating is advanced, advancedRatingBurns). Pure; synced state
 * only.
 */
export function npcAfterburning(npc: NpcState | undefined,
    aiFlags: Partial<Pick<ShipAIFlags,
        'alwaysHasAfterburner' | 'afterburnerAtAdvancedRating'>> | undefined,
    commanded: boolean, advancedRatingBurn = false): boolean {
    return npc !== undefined && !commanded
        && (aiFlags?.alwaysHasAfterburner === true
            || aiFlags?.afterburnerAtAdvancedRating === true
            && advancedRatingBurn)
        && npc.mode === 'attack' && npc.retreatSince === undefined;
}

/**
 * Applies the AI afterburner: after EffectiveMovementPhysicsSystem has
 * written this tick's movement physics from the hull (ionization
 * included), a burning NPC's top speed is raised to AI_AFTERBURNER_FACTOR
 * times its base, and its (ion-cut) acceleration multiplied by the same.
 * A cap still above that (overspeed bleeding off) is kept. Not during a
 * jump sequence (its burn owns the physics) and not while disabled.
 *
 * Reads the mode NpcDecisionSystem / NpcSteeringSystem left this tick:
 * steering runs before JumpSequenceSystem, which runs before
 * EffectiveMovementPhysicsSystem.
 */
export const NpcAfterburnerSystem = new System({
    name: 'NpcAfterburnerSystem',
    args: [NpcComponent, ShipDataComponent, ShipPhysicsComponent,
        MovementPhysicsComponent,
        Optional(EscortCommandComponent), Optional(JumpComponent),
        Optional(DisabledComponent),
        Optional(IonizationComponent), Optional(TargetComponent),
        Entities] as const,
    step(npc, shipData, shipPhysics, movementPhysics,
        escortCommand, jump, disabled, ionization, target, entities) {
        if (jump || disabled) {
            return;
        }
        // Only a Flags 0x0020 hull (without 0x0040) needs the draw.
        const advanced = shipData.aiFlags.afterburnerAtAdvancedRating
            && !shipData.aiFlags.alwaysHasAfterburner
            && npc.mode === 'attack'
            && advancedRatingBurns(
                // The attacked ship's pilot's rating; 0 for no target or
                // a ship with none (an NPC, an escort).
                (target?.target === undefined ? undefined
                    : entities.get(target.target)?.components
                        .get(CombatRatingComponent)?.kills) ?? 0);
        if (!npcAfterburning(npc, shipData.aiFlags,
            escortCommand !== undefined, advanced)) {
            return;
        }
        const base = getShipMovementPhysics(shipPhysics);
        const ion = ionSlowdown(ionization, shipPhysics.turnRate);
        movementPhysics.maxVelocity = Math.max(movementPhysics.maxVelocity,
            base.maxVelocity * ion.maxVelocity * AI_AFTERBURNER_FACTOR);
        movementPhysics.acceleration =
            base.acceleration * ion.acceleration * AI_AFTERBURNER_FACTOR;
    },
    // GravitySystem: both follow EffectiveMovementPhysicsSystem; the burn
    // writes the caps, gravity only the velocity (shared: MovementPhysics).
    after: [EffectiveMovementPhysicsSystem],
    before: [MovementSystem, GravitySystem],
});
