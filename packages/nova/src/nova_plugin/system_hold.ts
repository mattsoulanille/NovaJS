import * as t from 'io-ts';
import { Component } from 'nova_ecs/component';
import { Entity } from 'nova_ecs/entity';

/**
 * ============================================================================
 * SHIPS WITH UNFINISHED BUSINESS DO NOT LEAVE THE SYSTEM
 * ============================================================================
 * (Matthew's ruling, authoritative)
 *
 * "A ship shouldn't leave before being refuelled if it offers a 'refuel me'
 * mission." The stock case is the Refuel Trader (mïsn 141/650/651/652,
 * ShipGoal 5 "Rescue them"): a Civvies përs broadcasts its HailQuote over
 * the radio — "I'm out of fuel, can anybody help?" — and the player has to
 * fly across the system to answer it. An ordinary NPC rolls a departure
 * time at its first think (rollDepartureTime, 1-3 minutes), so the ship
 * asking for help would routinely warp out while the player was still on
 * their way, leaving a radio call from nobody.
 *
 * A ship carrying this component NEVER leaves the system under its own
 * power:
 *
 *  - it is never put into 'depart' mode by NpcDecisionSystem, so it keeps
 *    trading / patrolling instead of flying for the edge;
 *  - it cannot begin a hyperspace departure at all (npc_ai_plugin's
 *    departByJump refuses), which also covers the 'flee' exit — a trader
 *    that is attacked still runs, it just cannot warp away; and
 *  - the delete-at-the-edge fallback that removes a ship which could not
 *    jump is skipped for it, so fleeing to the rim does not despawn it
 *    through the back door.
 *
 * That is every way an NPC leaves a system UNDER ITS OWN POWER, which is
 * the whole of what the ruling is about. An NPC "landing" is modelled as
 * the trader dwell loop (npc_ai_plugin), which keeps the entity in the
 * world; the remaining exits are death, and being SWEPT ALONG by a
 * jumping leader (EscortFollowJumpBeginSystem) or by an owner leaving the
 * system — neither of which a held ship is ever in a position to take.
 * The people and rescue targets this marks fly alone, and a mission
 * special ship is excluded from the escort sweep outright
 * (sweepableEscorts), even the ones flying formation on the player under
 * ShipBehav 1; when their owner leaves, they are despawned rather than
 * carried (MissionShipCleanupSystem), and respawned on arrival.
 *
 * THE HOLD IS RELEASED as soon as the business is done — that is the whole
 * point of it being state rather than a permanent property:
 *
 *   'shipOffer'  the përs still has an unspent LinkMission of the rescue
 *                kind. Released by ShipOfferHoldReleaseSystem the moment
 *                the hull is marked ShipOfferSpentComponent (somebody
 *                accepted), after which the person may go about their
 *                business — and for the stock missions the hull is
 *                usually removed outright on the same tick anyway (përs
 *                Flags 0x0040 replaces it with the mission's own hulk).
 *   'rescue'     the ship IS the rescue target of an active mission
 *                (mïsn ShipGoal 5). Released by mission_ship_plugin's
 *                rescueBoarded, alongside the disable it lifts, so the
 *                refuelled trader is free to fly off and jump out.
 *   'missionGoal' the ship is a mission SPECIAL ship whose ShipGoal is
 *                still outstanding — destroy it, disable it, board it,
 *                escort it, observe it. The Bible implies the rule rather
 *                than stating it: ShipGoal 6 is "Chase them off (either
 *                kill them or scare them into jumping out of the
 *                system)", which is only a distinct goal because the
 *                ships of the other goals do NOT leave of their own
 *                accord. Chase-off targets are therefore the one kind of
 *                special ship that is never marked. Released by
 *                MissionShipTrackSystem once the objective is complete or
 *                failed. See mission_ship_spawn.ts.
 *
 *                This is the reason "Take Hyperioid Sample" (More
 *                Blasters CHEAT mïsn 1000) was impossible: its board
 *                target is a brave trader in NGC-1317, a system with no
 *                stellars, and a trader with nothing to fly to leaves —
 *                on its first think, one tick after it spawned, with a
 *                departure timer that had been suppressed for the next
 *                thirty thousand years.
 *
 * BELT AND BRACES ON THE 'rescue' SIDE, deliberately. A rescue target is
 * already pinned twice over — it spawns as a HULK, and a disabled ship
 * cannot jump at all (departByJump), and mission_ship_spawn sets its
 * `departAt` to MISSION_SHIP_NO_DEPART_MS so it never decides to leave
 * either. The marker is stamped anyway so that "the ship you must refuel
 * stays put until you refuel it" is true BY CONSTRUCTION rather than as a
 * coincidence of three unrelated mechanisms, and so that anything which
 * repairs the hulk without rescuing it cannot hand the player a mission
 * target that has flown away.
 *
 * DETERMINISM / ROLLBACK. Real simulation state: serializer-registered
 * (NpcAiPlugin's build), so it rides wire baselines, rollback snapshots
 * and the desync hash, and it is set at entity-construction time on every
 * peer alike — by the shared deterministic përs spawner (npc_spawn_plugin)
 * and by the mission-ship builder whose entities are baked into the accept
 * input record (mission_ship_spawn). Nothing here consults game data at
 * simulation time and nothing draws from the PRNG.
 */
/** The reasons this build knows. */
export type SystemHoldReason = 'shipOffer' | 'rescue' | 'missionGoal';
export const SystemHoldType = t.type({
    /**
     * Why this ship is staying (see the module comment). Encoded as a
     * plain string, not a union of literals, so a new reason is an
     * ADDITIVE change to the wire shape: a decoder that does not know
     * the reason still decodes the component (review r14 M4).
     */
    reason: t.string,
});
export type SystemHold = Omit<t.TypeOf<typeof SystemHoldType>, 'reason'>
    & { reason: SystemHoldReason };
export const SystemHoldComponent =
    new Component<SystemHold>('SystemHoldComponent');

/** Whether this ship is held in the system (see the module comment). The
 * single reading, shared by the AI's departure decision, its jump exit,
 * its delete-at-the-edge fallback, and the specs. */
export function heldInSystem(entity: Entity): boolean {
    return entity.components.has(SystemHoldComponent);
}
