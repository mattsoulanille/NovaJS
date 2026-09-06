import { DEFAULT_CARGO_NAMES } from 'novadatainterface/player_start_data';
import { cargoUsed } from '../ship/index.js';
import type { MissionWorkingState } from './mission_machinery.js';
import { ActiveMission } from '../player/index.js';

/**
 * Mission cargo bookkeeping: cargo names, the CargoComponent key mission
 * freight is held under, and loading/unloading it against the working
 * state. Split out of mission_logic.ts.
 */

/**
 * The standard cargo names (STR# 4000 in stock Nova). Kept as a
 * fallback for the built-in six commodities; the live names come from
 * the parsed PlayerStartData.cargoNames (DEFAULT_CARGO_NAMES).
 */
export const STANDARD_CARGO_NAMES = [...DEFAULT_CARGO_NAMES];

/**
 * The display name for a cargo type, resolved from the scenario's
 * parsed STR# 4000 names when supplied, else the built-in fallback.
 */
export function cargoName(cargoType: number,
    names: readonly string[] = STANDARD_CARGO_NAMES): string {
    return names[cargoType] || STANDARD_CARGO_NAMES[cargoType]
        || `Cargo ${cargoType}`;
}

/** The CargoComponent key that holds a mission's cargo. */
export function missionCargoKey(missionId: string): string {
    return `mission:${missionId}`;
}

export function freeCargoSpace(state: MissionWorkingState): number {
    return state.cargoCapacity - cargoUsed(state.cargo);
}

export function loadMissionCargo(state: MissionWorkingState,
    active: ActiveMission): boolean {
    if (active.cargoQty <= 0 || active.cargoLoaded) {
        return true;
    }
    if (active.cargoQty > freeCargoSpace(state)) {
        return false;
    }
    state.cargo.set(missionCargoKey(active.id), active.cargoQty);
    active.cargoLoaded = true;
    return true;
}

export function unloadMissionCargo(state: MissionWorkingState,
    active: ActiveMission): void {
    state.cargo.delete(missionCargoKey(active.id));
    active.cargoLoaded = false;
}
