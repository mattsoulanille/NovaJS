import { ShipAIFlags } from 'novadatainterface/ship_data';
import { Optional } from 'nova_ecs/optional';
import {
    MovementPhysicsComponent, MovementSystem,
} from 'nova_ecs/plugins/movement_plugin';
import { System } from 'nova_ecs/system';
import { EscortCommandComponent } from '../player/index.js';
import {
    DisabledComponent, getShipMovementPhysics, IonizationComponent,
    ionSlowdown, IsIonizedComponent,
    ShipDataComponent, ShipPhysicsComponent,
} from '../ship/index.js';
import { EffectiveMovementPhysicsSystem, JumpComponent } from '../travel/index.js';
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

/** How much the AI afterburner multiplies top speed and acceleration.
 * Measured (reference W1 wave 15): 5.6 vs 3.5 px a frame, same hull. */
export const AI_AFTERBURNER_FACTOR = 1.6;

/**
 * Whether this NPC burns its AI afterburner this tick: the whole time it is
 * attacking (thrusting or coasting), never while a player's escort command
 * drives it or while it holds a gövt 0x0010 stand-off. Pure; synced state
 * only.
 */
export function npcAfterburning(npc: NpcState | undefined,
    aiFlags: Pick<ShipAIFlags, 'alwaysHasAfterburner'> | undefined,
    commanded: boolean): boolean {
    return npc !== undefined && !commanded
        && aiFlags?.alwaysHasAfterburner === true
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
        Optional(DisabledComponent), Optional(IsIonizedComponent),
        Optional(IonizationComponent)] as const,
    step(npc, shipData, shipPhysics, movementPhysics,
        escortCommand, jump, disabled, isIonized, ionization) {
        if (jump || disabled || !npcAfterburning(npc, shipData.aiFlags,
            escortCommand !== undefined)) {
            return;
        }
        const base = getShipMovementPhysics(shipPhysics);
        const ion = ionSlowdown(ionization, isIonized);
        movementPhysics.maxVelocity = Math.max(movementPhysics.maxVelocity,
            base.maxVelocity * ion.maxVelocity * AI_AFTERBURNER_FACTOR);
        movementPhysics.acceleration =
            base.acceleration * ion.acceleration * AI_AFTERBURNER_FACTOR;
    },
    after: [EffectiveMovementPhysicsSystem],
    before: [MovementSystem],
});
