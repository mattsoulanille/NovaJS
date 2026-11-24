import {
    DEFAULT_CARGO_NAMES, DEFAULT_CARGO_NAMES_LOWER,
} from 'novadatainterface/player_start_data';
import { cargoUsed } from '../ship/index.js';
import type { MissionWorkingState } from './mission_machinery.js';
import { ActiveMission, missionCargoKey } from '../player/index.js';

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

/** The lowercase standard cargo names (STR# 4001 in stock Nova), the
 * fallback for the built-in six. */
export const STANDARD_CARGO_NAMES_LOWER = [...DEFAULT_CARGO_NAMES_LOWER];

/**
 * A mission cargo name as the screen shows it. The EVN Bible's note on
 * mission cargo: "Mission cargo names that start with the asterisk
 * character ('*') are treated as \"quantityless\" - i.e. their quantity
 * is never shown in the player-info dialog and the word \"the\" is
 * omitted in the message that appears when the player retrieves that
 * type of cargo from a ship". The '*' itself is a marker and never
 * shown (STR# 4000 index 27 "*Admiral Raczak" is retrieved as "Admiral
 * Raczak", reference "Boarding a rescue ship", wave 13).
 */
export interface MissionCargoName {
    /** The STR# 4000 name without its '*': "Admiral Raczak". */
    name: string;
    /**
     * The STR# 4001 lowercase name without its '*', for running text
     * (<CT>, the player-info list, the retrieval line): "artwork",
     * "space probe", "Admiral Raczak". The STR# 4000 name when the
     * lowercase list has no entry.
     */
    lower: string;
    /** Whether the name was marked '*' (in either list). */
    quantityless: boolean;
}

/** Splits a raw STR# cargo name into its shown text and its '*' mark. */
export function parseCargoName(raw: string):
    { text: string, quantityless: boolean } {
    return raw.startsWith('*')
        ? { text: raw.slice(1), quantityless: true }
        : { text: raw, quantityless: false };
}

/**
 * Resolves cargo type `cargoType` against the scenario's STR# 4000
 * (`names`) and STR# 4001 (`lowerNames`) tables, with the '*' rule
 * applied. Every place a mission cargo name reaches the screen goes
 * through here.
 */
export function missionCargoName(cargoType: number,
    names: readonly string[] = STANDARD_CARGO_NAMES,
    lowerNames: readonly string[] = STANDARD_CARGO_NAMES_LOWER):
    MissionCargoName {
    const upper = parseCargoName(cargoName(cargoType, names));
    // A scenario's own lowercase entry, else the stock one only when the
    // proper-case name is the stock one too (a plug-in's renamed Food
    // must not read "food" in running text).
    const lowerRaw = lowerNames[cargoType]
        || (names[cargoType] ? undefined
            : STANDARD_CARGO_NAMES_LOWER[cargoType]);
    const lower = lowerRaw !== undefined ? parseCargoName(lowerRaw) : upper;
    return {
        name: upper.text,
        lower: lower.text,
        quantityless: upper.quantityless || lower.quantityless,
    };
}

/** `text` with its first letter capitalized ("space probe" ->
 * "Space probe"), for a cargo name that starts a sentence. */
export function capitalizeFirst(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The player-info dialog's cargo-list line for a mission's cargo. A
 * quantityless ('*') name is the lowercase name alone, sentence-cased:
 * the original's player info shows "Space probe." for STR# 4001
 * "*space probe" (p_properties/cargo_with_stuff.png), and stock "*Admiral
 * Raczak" reads "Admiral Raczak.". Any other mission cargo shows its
 * quantity, which is what the Bible's note implies by exempting only the
 * '*' names: "5 tons of artwork.".
 */
export function playerInfoMissionCargoLine(cargo: MissionCargoName,
    tons: number): string {
    if (cargo.quantityless) {
        return `${capitalizeFirst(cargo.lower)}.`;
    }
    return `${tons} ton${tons === 1 ? '' : 's'} of ${cargo.lower}.`;
}

/** The CargoComponent key that holds a mission's cargo (defined in the
 * player domain, which the rescue board below the missions shares). */
export { missionCargoKey };

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
