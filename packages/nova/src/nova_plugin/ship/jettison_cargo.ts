import * as t from 'io-ts';
import { EcsEvent } from 'nova_ecs/events';
import { World } from 'nova_ecs/world';
import { registerSimulationBridgeEvent } from '../../communication/simulation_bridge_events.js';
import {
    ActiveMission, findControlledEntity, Missions, MissionsComponent,
} from '../player/index.js';
import { Cargo, CargoComponent } from './cargo_plugin.js';

/**
 * ============================================================================
 * Jettison Cargo (the player-info dialog's Cargo page)
 * ============================================================================
 *
 * MEASURED on the original (reference "Jettison cargo, wave 55", runs 2-7,
 * stock data plus a run-only mïsn override):
 *
 *  - The button empties the WHOLE hold at once: every commodity, junk and
 *    every mission's cargo, the 0-ton passenger kind ("Barry Fletcher")
 *    included. It asks first ("Are you sure you want to jettison your
 *    cargo?", Cancel / OK); OK closes the dialog.
 *  - Every mission whose cargo was ABOARD fails at once: its OnFailure
 *    runs, it leaves the mission list, and nothing else happens to the
 *    pilot (no record change for the CompGovt, whatever the CompReward;
 *    no FailText, then or at the next landing; mïsn Flags 0x0080 "global
 *    penalty when jettisoning mission cargo" changed nothing, as the Bible
 *    says). A mission with no cargo, or whose cargo is still to be picked
 *    up (PickupMode 1, not yet at its TravelStel), is untouched.
 *  - In flight the status line says "Cargo jettisoned." (STR# 2002 #289),
 *    or "Mission failed." when a mission failed, and ONE cargo box (spïn
 *    500 "Boxes") tumbles away from the ship at 10-20 px/s and fades out
 *    after about 6-8 s. A ship carrying an Asteroid Scoop did not pick up
 *    its own box beside it. Docked: the same dump, no message, no box.
 *  - The dump-cargo key of the original's key set ('k') does nothing.
 *
 * IN FLIGHT the dump is the `jettisonCargo` input record, applied here to
 * the SENDER's own ship on every peer at the same tick (it needs no
 * mission data): the hold is emptied and each mission whose cargo was
 * aboard is marked `failed` with cause 'jettison', the same shared marker
 * every other sim-observed failure uses. The owner's client then runs the
 * OnFailure in flight as a `missionSetString` record
 * (missions/mission_set_string_record.ts), and the cause makes the
 * failure cost no record and show no FailText
 * (missions/mission_transitions.ts failMission). The box is a display
 * effect of {@link CargoJettisonedEvent}, never sim state.
 *
 * DOCKED the dump is an edit of the landing's working copy
 * (spaceport/spaceport.ts), through the same {@link jettisonedMissionIds}.
 *
 * KNOWN GAP: the 0-ton passenger kind. The original failed it with the
 * rest, but NovaJS's offer turns a 0-ton cargo into no cargo at all
 * (missions/mission_offer.ts: cargoType -1), so such a mission is not
 * "aboard" here and a jettison leaves it alone. Modelling passengers as
 * cargo (the Cargo page's "and Barry Fletcher" too) is its own change.
 */

/**
 * Whether `active`'s cargo is aboard, the measured test for a jettison
 * failing it: a cargo type that has been loaded (see the module note for
 * the 0-ton kind). A mission already failed is out of play.
 */
export function missionCargoAboard(active: ActiveMission): boolean {
    return active.cargoType >= 0 && active.cargoLoaded && !active.failed;
}

/** The missions a jettison fails: those whose cargo is aboard, by id. */
export function jettisonedMissionIds(missions: Missions | undefined): string[] {
    return [...(missions ?? new Map()).entries()]
        .filter(([, active]) => missionCargoAboard(active))
        .map(([id]) => id)
        .sort();
}

/**
 * Whether there is anything to jettison: any tons in the hold, or a
 * mission's cargo aboard. The original hides the button with nothing
 * aboard ("You don't have any cargo aboard your ship").
 */
export function hasJettisonableCargo(cargo: Cargo | undefined,
    missions: Missions | undefined): boolean {
    for (const tons of (cargo ?? new Map()).values()) {
        if (tons > 0) {
            return true;
        }
    }
    return jettisonedMissionIds(missions).length > 0;
}

/**
 * Emitted at the jettisoning ship (`[uuid]`) the tick a jettison is
 * applied: the display shows its status line ("Cargo jettisoned." /
 * "Mission failed.") on the owner's client and the tumbling cargo box on
 * every client.
 */
export const CargoJettisonedEventType = t.type({ missionFailed: t.boolean });
export type CargoJettisoned = t.TypeOf<typeof CargoJettisonedEventType>;
export const CargoJettisonedEvent =
    new EcsEvent<CargoJettisoned>('CargoJettisonedEvent');
registerSimulationBridgeEvent({ event: CargoJettisonedEvent });

/**
 * Applies a peer's `jettisonCargo` input to the ship it controls (and only
 * that one). A ship with nothing to jettison is left alone (the button is
 * hidden then; a stale or replayed record changes nothing). Synchronous
 * and free of randomness: the hold is replaced, never edited in place, and
 * the failed missions are replaced in the list.
 */
export function applyJettisonCargo(world: World, peerId: string | undefined) {
    const found = findControlledEntity(world, peerId);
    if (!found) {
        return;
    }
    const { entity, uuid } = found;
    const cargo = entity.components.get(CargoComponent);
    const missions = entity.components.get(MissionsComponent);
    if (!hasJettisonableCargo(cargo, missions)) {
        return;
    }
    entity.components.set(CargoComponent, new Map());
    const failed = jettisonedMissionIds(missions);
    if (missions) {
        for (const id of failed) {
            const active = missions.get(id)!;
            missions.set(id, {
                ...active, cargoLoaded: false, failed: true,
                failCause: 'jettison',
            });
        }
    }
    world.emit(CargoJettisonedEvent, { missionFailed: failed.length > 0 },
        [uuid]);
}
