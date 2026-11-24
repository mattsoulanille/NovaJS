import { ShipAIFlags } from 'novadatainterface/ship_data';
import { Optional } from 'nova_ecs/optional';
import {
    MovementPhysicsComponent, MovementStateComponent, MovementSystem,
} from 'nova_ecs/plugins/movement_plugin';
import { System } from 'nova_ecs/system';
import { EscortCommandComponent } from '../player/index.js';
import {
    DisabledComponent, getShipMovementPhysics, ION_FACTOR, IsIonizedComponent,
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
 * Here: an NPC of such a hull burns while it is ATTACKING (NpcSteeringSystem
 * 'attack') and thrusting at its target, which that arm does only beyond
 * its stand-off distance; inside it the ship coasts, and the boosted speed
 * bleeds off as after a player's burn (afterburner_plugin.ts's
 * decayedSpeedCap). That is the simplest rule that gives both halves of the
 * measurement. NpcAfterburnerSystem applies the boost on top of what
 * travel's EffectiveMovementPhysicsSystem wrote this tick.
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
 * Whether this NPC burns its AI afterburner this tick. `accelerating` is
 * the thrust NpcSteeringSystem has just set (MovementState.accelerating).
 * Pure; synced state only.
 */
export function npcAfterburning(npc: NpcState | undefined,
    aiFlags: Pick<ShipAIFlags, 'alwaysHasAfterburner'> | undefined,
    accelerating: number, commanded: boolean): boolean {
    return npc !== undefined && !commanded
        && aiFlags?.alwaysHasAfterburner === true
        && npc.mode === 'attack' && npc.retreatSince === undefined
        && accelerating > 0;
}

/**
 * Applies the AI afterburner: after EffectiveMovementPhysicsSystem has
 * written this tick's movement physics from the hull (ionization
 * included), a burning NPC's top speed is raised to AI_AFTERBURNER_FACTOR
 * times its (ion-slowed) base, and its acceleration multiplied by the same.
 * A cap still above that (overspeed bleeding off) is kept. Not during a
 * jump sequence (its burn owns the physics) and not while disabled.
 *
 * Reads the thrust NpcSteeringSystem set this tick: steering runs before
 * JumpSequenceSystem, which runs before EffectiveMovementPhysicsSystem.
 */
export const NpcAfterburnerSystem = new System({
    name: 'NpcAfterburnerSystem',
    args: [NpcComponent, ShipDataComponent, ShipPhysicsComponent,
        MovementPhysicsComponent, MovementStateComponent,
        Optional(EscortCommandComponent), Optional(JumpComponent),
        Optional(DisabledComponent), Optional(IsIonizedComponent)] as const,
    step(npc, shipData, shipPhysics, movementPhysics, movementState,
        escortCommand, jump, disabled, isIonized) {
        if (jump || disabled || !npcAfterburning(npc, shipData.aiFlags,
            movementState.accelerating, escortCommand !== undefined)) {
            return;
        }
        const base = getShipMovementPhysics(shipPhysics);
        const slowness = isIonized ? ION_FACTOR : 1;
        movementPhysics.maxVelocity = Math.max(movementPhysics.maxVelocity,
            base.maxVelocity * slowness * AI_AFTERBURNER_FACTOR);
        movementPhysics.acceleration =
            base.acceleration * slowness * AI_AFTERBURNER_FACTOR;
    },
    after: [EffectiveMovementPhysicsSystem],
    before: [MovementSystem],
});
