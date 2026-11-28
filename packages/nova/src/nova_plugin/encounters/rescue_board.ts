import * as t from 'io-ts';
import { Entity } from 'nova_ecs/entity';
import { EntityMap } from 'nova_ecs/entity_map';
import { EcsEvent } from 'nova_ecs/events';
import { registerSimulationBridgeEvent } from '../../communication/simulation_bridge_events.js';
import {
    ActiveMission, missionCargoKey, MissionsComponent,
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
 * Boarding a LIVE mission's special ship: never a plunder
 * ============================================================================
 *
 * The original never plunders, captures or stows the special ship of a
 * mission that is still running and has not failed, whatever its ShipGoal
 * (reference "Boarding live mission ships, wave 61", read off the
 * original's HandlePlayerBoardAttempt and measured on several goals). Past
 * the ordinary range / speed / alignment gate, its board is one of:
 *
 *  - THE RETRIEVAL, when the mission carries PickupMode-2 cargo not yet
 *    aboard: the status line "You retrieved Admiral Raczak from this
 *    ship." and NOTHING ELSE: no plunder dialog, and the hulk stays
 *    Disabled (reference "Boarding a rescue ship: stock \"Rescue Raczak\"
 *    (nova:394), wave 13"). It credits a board / rescue goal; the mission
 *    completes when the cargo is dropped off. Any goal: the original
 *    tests the PickupMode before the goal.
 *  - THE DEFERRED AUTO-ABORT RESCUE (mïsn Flags 0x0001 with a përs
 *    replacement: the four stock Refuel Traders, `autoAbortOnBoard`): the
 *    owner's first board is the rescue itself, with NO dialog, only a
 *    status line (RescueBoardedEvent: the stock Refuel Trader's
 *    "Valkyrie:  Energy transfer complete, rescue-a.", a mission that
 *    takes no fuel's "Target ship has been boarded."; reference "The
 *    Refuel Trader rescue", 2026-11-27, and "The deferred (përs)
 *    auto-abort (R16), wave 43"). It spends the hull's one board through
 *    the durable BoardedComponent record, which is what
 *    MissionShipTrackSystem's rescueBoarded reads to pay, take the fuel,
 *    release the ship and mark the mission's abort pending.
 *  - otherwise a SILENT board: nothing on the status line, and it uses up
 *    the hull's one board WITHOUT crediting anything (the original's board
 *    counter moves only on the two boards above, so a board or rescue
 *    goal without PickupMode-2 cargo can never be completed by boarding).
 *    Every later press is "You can't board this ship." (reference "H1 /
 *    rescue leftovers, wave 21", finding 5, for a no-cargo rescue; wave 61
 *    for the other goals, the RAGE Gunboats of "Destroy Bureau Cell"
 *    among them: no plunder dialog, ever).
 *
 * A live special ship whose one board is spent answers every press with
 * "You can't board this ship." BEFORE the range and alignment gates
 * (missionShipBoardSpent: the original tests its boarded flag first, so
 * wave 61's sweeps read the line at every heading).
 *
 * WHEN THE SHIP IS ORDINARY AGAIN (kind 'none': plunder, capture):
 *  - its mission has FAILED in flight (a disabled escort ally, a disable
 *    target destroyed, any sim-marked failure): the original's failed flag
 *    sends the board to the plunder dialog (reference "Reviving a disabled
 *    ally, wave 11") — though a PickupMode-2 retrieval and the deferred
 *    rescue still come first, as there;
 *  - its mission is over: an in-flight abort clears the original's
 *    mission index on every special ship (AbortMission), so an UNBOARDED
 *    ship of an aborted mission is an ordinary ship; NovaJS's `untethered`
 *    marks it (missions/mission_ship_release.ts), and the auto-abort
 *    ambushes are untethered from birth (wave 11's auto-aborting goal-5
 *    ship opened the plunder dialog);
 *  - its owner is not in the world (a departed peer's), and aux ships
 *    (GUESS: not measured).
 *
 * Only the mission's OWNER boards. Anybody else — a rival player — is
 * refused while the mission runs, as the original refuses everyone but
 * the one pilot it has.
 */

/** What a board of this hull is, under the rule above. */
export type MissionShipBoard =
    /** Not a live mission ship: the ordinary boarding rules apply. */
    | { kind: 'none' }
    /** A live mission ship that cannot be boarded now. */
    | { kind: 'refuse' }
    /** The owner's first board of a live mission ship with no mission
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
export function missionShipBoard(target: Entity, targetUuid: string,
    boarderUuid: string, entities: EntityMap): MissionShipBoard {
    const missionShip = target.components.get(MissionShipComponent);
    if (!missionShip || missionShip.aux || missionShip.untethered) {
        return { kind: 'none' };
    }
    const owner = entities.get(missionShip.owner);
    const active = owner?.components.get(MissionsComponent)
        ?.get(missionShip.mission);
    const objective = active?.shipObjective;
    if (!owner || !active || !objective) {
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
    // PickupMode 2, whatever the quantity: the original's pickup succeeds
    // outright for a quantity of 0 (DoMissionCargoPickup), so stock mïsn
    // 710 "Set and Launch Trap" (PickupMode 2, CargoQty 0) is completed by
    // this board too.
    if (active.pickupOnBoard) {
        if (active.cargoLoaded) {
            return { kind: 'refuse' };
        }
        // The cargo must fit. The original refuses such a board too, after
        // a text dialog saying the hold is too small (STR# 2002; not
        // shown here): the cargo stays aboard the hulk for later.
        const cargo = owner.components.get(CargoComponent);
        const physics = owner.components.get(ShipPhysicsComponent);
        if (active.cargoQty > 0 && (!cargo || !physics
            || active.cargoQty > physics.freeCargo - cargoUsed(cargo))) {
            return { kind: 'refuse' };
        }
        return { kind: 'retrieve', owner, active, objective };
    }
    // A failed mission's ship is an ordinary hulk again: plunder.
    if (objective.failed || active.failed) {
        return { kind: 'none' };
    }
    // Nothing aboard to take (no PickupMode 2; GUESS: cargo loaded at the
    // spaceport reads the same): the one board is spent silently.
    // A hull not yet registered on the objective has no flag to spend it
    // on, so it is refused as before.
    return flags ? { kind: 'silent', objective } : { kind: 'refuse' };
}

/**
 * Whether a press on `target` by `boarderUuid` is refused before the range
 * and alignment gates: a live special ship whose one board is spent. The
 * original tests its boarded flag first, so the line comes at any
 * distance and heading (wave 61). Pure: reads synced state only.
 */
export function missionShipBoardSpent(target: Entity, targetUuid: string,
    entities: EntityMap): boolean {
    const missionShip = target.components.get(MissionShipComponent);
    if (!missionShip || missionShip.aux || missionShip.untethered) {
        return false;
    }
    const active = entities.get(missionShip.owner)
        ?.components.get(MissionsComponent)?.get(missionShip.mission);
    return !!active?.shipObjective?.live.get(targetUuid)?.boarded;
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
    retrieve: Extract<MissionShipBoard, { kind: 'retrieve' }>,
    targetUuid: string, target?: Entity): void {
    const { owner, active, objective } = retrieve;
    if (active.cargoQty > 0) {
        owner.components.get(CargoComponent)!
            .set(missionCargoKey(active.id), active.cargoQty);
    }
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
 * The silent board: marks the hull boarded (its one board is spent, so
 * every later press is refused) WITHOUT crediting the goal (shipBoarded
 * would count it, and the original's mission stayed active). Nothing else
 * changes: the hulk stays disabled and held, and a WAITING ShipStart-2
 * ship stays where it waits (GUESS: the measured run was a hulk; only the
 * retrieval was seen to release a waiting ship).
 *
 * The spend is ALSO written to the hull's durable boarding record, spent
 * by the boarder, because it outlives the mission: on the original a ship
 * boarded this way still answered "You can't board this ship." after its
 * mission was aborted in flight (reference "Boarding live mission ships,
 * wave 61": the ship's own boarded flag, which the abort leaves alone),
 * where an aborted mission's UNBOARDED ship is an ordinary one. The
 * record is what the ordinary one-plunder rule reads once the ship is
 * untethered. MissionShipTrackSystem reads it too, but finds the hull's
 * objective flag already set, so nothing is credited or picked up.
 */
export function spendRescueBoard(
    silent: Extract<MissionShipBoard, { kind: 'silent' }>,
    targetUuid: string, target: Entity, boarderUuid: string): void {
    const flags = silent.objective.live.get(targetUuid);
    if (flags) {
        flags.boarded = true;
    }
    if (!target.components.has(BoardedComponent)) {
        target.components.set(BoardedComponent,
            { boarder: boarderUuid, plundered: true });
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
 * index 2; reference "The Refuel Trader rescue", 2026-11-27); without
 * (wave 43's kit mission, no Flags 0x0008) "Target ship has been
 * boarded." (index 125).
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
