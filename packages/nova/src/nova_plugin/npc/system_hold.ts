import * as t from 'io-ts';
import { Component } from 'nova_ecs/component';
import { Entity } from 'nova_ecs/entity';
import { openEnum } from '../../common/open_enum.js';

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
 *                kind (ShipGoal 5 — npc_spawn_plugin resolves that at
 *                spawn-staging time and sets `holdsForOffer`, so in stock
 *                data this is the four Refuel Traders and nothing else).
 *                Released by `applyAcceptMission` (mission_accept.ts) the
 *                moment the hull is marked ShipOfferSpentComponent —
 *                somebody accepted — after which the person may go about
 *                their business, and for the stock missions the hull is
 *                usually removed outright on the same tick anyway (përs
 *                Flags 0x0040 replaces it with the mission's own hulk).
 *                Capture releases it too (boarding_plugin): a prize
 *                belongs to the player, not to its old errand.
 *
 *                REFUSING DOES NOT RELEASE IT, and must not. The original
 *                re-offers a refused mission on the next hail and so does
 *                this (see ship_mission_offer_plugin's module note:
 *                refusing leaves no state behind), so a released hold
 *                would let the ship warp out between one "no" and the
 *                player changing their mind. Nor does an offer that is
 *                UNAVAILABLE right now — the 16-mission hold is full, or
 *                the player already carries this very mïsn from another
 *                Refuel Trader, or the përs quote gates do not match the
 *                encounter — because none of those is permanent: an
 *                active mission can complete or fail in flight, and the
 *                gates move with the fight.
 *
 *                So the hold cannot outlive its usefulness. Its ceiling is
 *                the SYSTEM WORLD's own lifetime: every system is a
 *                separate world and leaving one destroys it and every NPC
 *                in it, so the worst case is a Refuel Trader that circles
 *                the system for the rest of one visit instead of warping
 *                out — which is the ruling above, not a leak.
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
/**
 * The reasons this build knows. An OPEN enum on the wire (see openEnum):
 * a new reason is an ADDITIVE change to the shape, so a decoder that does
 * not know it still decodes the component (review r14 M4) — nothing
 * branches on the reason, only on the component's presence (heldInSystem),
 * so an unknown one is harmless once decoded.
 */
export const SystemHoldReasonType = openEnum('SystemHoldReason',
    ['shipOffer', 'rescue', 'missionGoal'] as const);
export type SystemHoldReason = t.TypeOf<typeof SystemHoldReasonType>;
export const SystemHoldType = t.type({
    /** Why this ship is staying (see the module comment). */
    reason: SystemHoldReasonType,
});
export type SystemHold = t.TypeOf<typeof SystemHoldType>;
export const SystemHoldComponent =
    new Component<SystemHold>('SystemHoldComponent');

/** Whether this ship is held in the system (see the module comment). The
 * single reading, shared by the AI's departure decision, its jump exit,
 * its delete-at-the-edge fallback, and the specs. */
export function heldInSystem(entity: Entity): boolean {
    return entity.components.has(SystemHoldComponent);
}
