import * as t from 'io-ts';
import { Entity } from 'nova_ecs/entity';
import { EntityMap } from 'nova_ecs/entity_map';
import { EcsEvent } from 'nova_ecs/events';
import { registerSimulationBridgeEvent } from '../../communication/simulation_bridge_events.js';
import {
    ActiveMission, GOAL_RESCUE, missionCargoKey, MissionsComponent,
    MissionShipComponent, shipBoarded, ShipObjective,
} from '../player/index.js';
import {
    CargoComponent, cargoUsed, ShipPhysicsComponent,
} from '../ship/index.js';
import {
    NpcComponent, SystemHoldComponent, waitingForRescue,
} from '../npc/index.js';

/**
 * ============================================================================
 * Boarding a RESCUE ship (mïsn ShipGoal 5) only picks up its cargo
 * ============================================================================
 *
 * The Bible's ShipGoal 5 is "Rescue them (they start out disabled and stay
 * that way until you board them)", but the original does not let the
 * player board a live rescue ship at all, except to take its mission cargo
 * (reference "Boarding a rescue ship: stock \"Rescue Raczak\" (nova:394),
 * wave 13"):
 *
 *  - WITH PickupMode-2 cargo not yet aboard, the board (past the ordinary
 *    range / speed / alignment gate — 16 silent misaligned presses, then
 *    the 17th) loads the cargo with the status line "You retrieved Admiral
 *    Raczak from this ship." and NOTHING ELSE: no plunder dialog, and the
 *    hulk stays Disabled. Every later press is "You can't board this
 *    ship.". The mission completes when the cargo is dropped off.
 *  - WITHOUT it, every press is "You can't board this ship.", from the
 *    first (the stock düde too: mïsn 1072), so the mission can never be
 *    completed by boarding (wave 11's kit refusals were this rule).
 *
 * So for the ship of a LIVE rescue mission the board is never a plunder,
 * a capture, a bay stow or an escort repair: it is the retrieval or a
 * refusal. The retrieval credits the rescue goal on the spot (shipBoarded,
 * the same transition a plunder board used to make), which is what lets
 * the drop-off complete the mission; the cargo's DropOffMode then does
 * the rest at landing, as for any mission cargo.
 *
 * NOT COVERED, and so left on the ordinary boarding rules:
 *  - the DEFERRED auto-abort rescue (mïsn Flags 0x0001 with a përs
 *    replacement: the four stock Refuel Traders, `autoAbortOnBoard`).
 *    Whether the original refuses those too is untested (wave 11 left it
 *    for a përs kit), and boarding is how they end today
 *    (MissionShipTrackSystem's rescueBoarded);
 *  - a ship whose owner is not in the world (a departed peer's), an
 *    untethered one, and an aux ship: none is a live rescue target.
 *
 * Only the mission's OWNER retrieves. Anybody else — a rival player — is
 * refused while the mission runs, as the original refuses everyone but
 * the one pilot it has.
 */

/** What a board of this hull is, under the rule above. */
export type RescueBoard =
    /** Not a live rescue ship: the ordinary boarding rules apply. */
    | { kind: 'none' }
    /** A live rescue ship that cannot be boarded now. */
    | { kind: 'refuse' }
    /** The owner takes the mission cargo off it. */
    | {
        kind: 'retrieve', owner: Entity, active: ActiveMission,
        objective: ShipObjective,
    };

/**
 * Classifies the board of `target` (uuid `targetUuid`) by the ship
 * `boarderUuid`. Pure: reads synced state only.
 */
export function rescueBoard(target: Entity, targetUuid: string,
    boarderUuid: string, entities: EntityMap): RescueBoard {
    const missionShip = target.components.get(MissionShipComponent);
    if (!missionShip || missionShip.aux || missionShip.untethered) {
        return { kind: 'none' };
    }
    const owner = entities.get(missionShip.owner);
    const active = owner?.components.get(MissionsComponent)
        ?.get(missionShip.mission);
    const objective = active?.shipObjective;
    if (!owner || !active || !objective || objective.goal !== GOAL_RESCUE
        || active.autoAbortOnBoard) {
        return { kind: 'none' };
    }
    if (missionShip.owner !== boarderUuid || !active.pickupOnBoard
        || active.cargoLoaded || active.cargoQty <= 0
        || objective.live.get(targetUuid)?.boarded) {
        return { kind: 'refuse' };
    }
    // The cargo must fit. Not measured on the original (the reference
    // pilot had room): a full hold is refused like any other board that
    // cannot happen, and the cargo stays aboard the hulk for later.
    const cargo = owner.components.get(CargoComponent);
    const physics = owner.components.get(ShipPhysicsComponent);
    if (!cargo || !physics
        || active.cargoQty > physics.freeCargo - cargoUsed(cargo)) {
        return { kind: 'refuse' };
    }
    return { kind: 'retrieve', owner, active, objective };
}

/**
 * The retrieval itself: the mission cargo into the owner's hold under the
 * key the landing's drop-off reads, and the rescue goal credited for this
 * hull. A HULK is left exactly as it is — disabled, held, unboarded. A
 * ship that was WAITING (mïsn ShipStart 2, live: npc/system_hold.ts's
 * waitingForRescue) is RELEASED and flies off: reference "Contraband /
 * rescue / A14, wave 19", finding 4 — after "You retrieved Admiral Raczak
 * from this ship." it showed Shield 100% and was 250 px away 1.5 s later.
 * GUESS: it leaves the system (mode 'depart'; the reference watched only
 * the first seconds).
 */
export function retrieveRescueCargo(
    retrieve: Extract<RescueBoard, { kind: 'retrieve' }>,
    targetUuid: string, target?: Entity): void {
    const { owner, active, objective } = retrieve;
    owner.components.get(CargoComponent)!
        .set(missionCargoKey(active.id), active.cargoQty);
    active.cargoLoaded = true;
    shipBoarded(objective, targetUuid);
    if (target && waitingForRescue(target)) {
        target.components.delete(SystemHoldComponent);
        const npc = target.components.get(NpcComponent);
        if (npc) {
            npc.mode = 'depart';
        }
    }
}

/**
 * Emitted (targeted at the boarding ship) when a rescue board retrieves
 * the mission cargo: the status line's "You retrieved <cargo> from this
 * ship." (display/status_message_plugin.ts). Carries the cargo TYPE; the
 * display names it from the scenario's STR# 4000. Never mutates the
 * simulation.
 */
export const MissionCargoRetrievedEvent =
    new EcsEvent<{ cargoType: number }>('MissionCargoRetrievedEvent');
export const MissionCargoRetrievedEventType = t.type({ cargoType: t.number });
registerSimulationBridgeEvent({ event: MissionCargoRetrievedEvent });
