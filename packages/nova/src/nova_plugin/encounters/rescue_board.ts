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
    BoardedComponent, CargoComponent, cargoUsed, ShipPhysicsComponent,
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
 *  - WITHOUT it, the FIRST press past the gate is a SILENT board: nothing
 *    on the status line, and it uses up the hulk's one board; every later
 *    press is "You can't board this ship." (reference "H1 / rescue
 *    leftovers, wave 21", finding 5: a misaligned press silent, the first
 *    aligned one silent too, then the refusal twice; wave 19's single
 *    silent press at 10 deg apart fits). Nothing is retrieved and the
 *    goal is NOT credited, so the mission can never be completed by
 *    boarding (the hulk stayed "Disabled" and the mission active; wave
 *    11's kit refusals, and wave 13's stock mïsn 1072, were the later
 *    presses).
 *
 * So for the ship of a LIVE rescue mission the board is never a plunder,
 * a capture, a bay stow or an escort repair: it is the retrieval, the
 * silent no-cargo board, or a refusal. The retrieval credits the rescue goal on the spot (shipBoarded,
 * the same transition a plunder board used to make), which is what lets
 * the drop-off complete the mission; the cargo's DropOffMode then does
 * the rest at landing, as for any mission cargo.
 *
 * THE DEFERRED AUTO-ABORT RESCUE (mïsn Flags 0x0001 with a përs
 * replacement: the four stock Refuel Traders, `autoAbortOnBoard`) is the
 * third kind of board, 'deferred': the owner's first board is the rescue
 * itself, with NO dialog — the status line "Target ship has been
 * boarded." (STR# 2002 index 125) and nothing else (reference "The
 * deferred (përs) auto-abort (R16), wave 43", and "Refuel rescue",
 * 2026-11-27, on the stock Refuel Trader). It spends the hull's one
 * board through the durable BoardedComponent record, which is what
 * MissionShipTrackSystem's rescueBoarded reads to pay, take the fuel,
 * release the ship and mark the mission's abort pending. No plunder
 * session opens, so the plunder dialog can never flash up. Every later
 * press is refused.
 *
 * NOT COVERED, and so left on the ordinary boarding rules:
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
    /** The owner's first board of a live rescue ship with no mission
     * cargo to take: silent, and it spends the hull's one board
     * ({@link spendRescueBoard}). */
    | { kind: 'silent', objective: ShipObjective }
    /** The owner's first board of a deferred auto-abort rescue ship (a
     * përs replacement): the rescue, with no dialog
     * ({@link boardDeferredRescue}). */
    | {
        kind: 'deferred',
        /** The mission takes the 100 units of fuel the player hands over
         * (mïsn Flags 0x0008): the status line says "Energy transfer
         * complete" instead of "Target ship has been boarded.". */
        energyTransfer: boolean,
    }
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
    if (!owner || !active || !objective || objective.goal !== GOAL_RESCUE) {
        return { kind: 'none' };
    }
    const flags = objective.live.get(targetUuid);
    if (missionShip.owner !== boarderUuid || flags?.boarded) {
        return { kind: 'refuse' };
    }
    if (active.autoAbortOnBoard) {
        // Spent already, even if the goal credit has not run yet (the
        // record is written here and read by MissionShipTrackSystem).
        return active.autoAbortPending
            || target.components.get(BoardedComponent)?.plundered
            ? { kind: 'refuse' }
            : {
                kind: 'deferred',
                energyTransfer: (active.autoAbortFuel ?? 0) > 0,
            };
    }
    // Nothing aboard to take (no PickupMode-2 cargo; GUESS: cargo loaded
    // at the spaceport reads the same): the one board is spent silently.
    // A hull not yet registered on the objective has no flag to spend it
    // on, so it is refused as before.
    if (!active.pickupOnBoard || active.cargoQty <= 0) {
        return flags ? { kind: 'silent', objective } : { kind: 'refuse' };
    }
    if (active.cargoLoaded) {
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
 * The silent no-cargo board: marks the hull boarded (its one board is
 * spent, so every later press is refused) WITHOUT crediting the rescue
 * goal (shipBoarded would count it, and the original's mission stayed
 * active). Nothing else changes: the hulk stays disabled and held, and a
 * WAITING ShipStart-2 ship stays where it waits (GUESS: the measured run
 * was a hulk; only the retrieval was seen to release a waiting ship).
 */
export function spendRescueBoard(
    silent: Extract<RescueBoard, { kind: 'silent' }>,
    targetUuid: string): void {
    const flags = silent.objective.live.get(targetUuid);
    if (flags) {
        flags.boarded = true;
    }
}

/**
 * The deferred auto-abort rescue's board (kind 'deferred'): the durable
 * boarding record, spent by the owner, with no session open. Everything
 * the rescue does follows from it in MissionShipTrackSystem (rescueBoarded:
 * the pay, the fuel, the ship released, the abort pending), exactly as a
 * plunder board used to trigger it — only without the plunder dialog.
 */
export function boardDeferredRescue(target: Entity,
    boarderUuid: string): void {
    target.components.set(BoardedComponent,
        { boarder: boarderUuid, plundered: true });
}

/**
 * Emitted (targeted at the boarding ship) when the owner boards a
 * deferred auto-abort rescue ship (boardDeferredRescue): the status line,
 * the only thing the original shows. With `energyTransfer` (the mission
 * takes the player's fuel: the stock Refuel Traders) it is the rescued
 * ship's "Valkyrie:  Energy transfer complete, rescue-a." (STR# 2002
 * index 2; reference "Refuel rescue", 2026-11-27); without (wave 43's kit
 * mission, no Flags 0x0008) "Target ship has been boarded." (index 125).
 * GUESS: that the fuel flag is what picks the line (two missions, one
 * each). Never mutates the simulation.
 */
export const RescueBoardedEvent =
    new EcsEvent<{ energyTransfer: boolean }>('RescueBoardedEvent');
export const RescueBoardedEventType = t.type({ energyTransfer: t.boolean });
registerSimulationBridgeEvent({ event: RescueBoardedEvent });

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
