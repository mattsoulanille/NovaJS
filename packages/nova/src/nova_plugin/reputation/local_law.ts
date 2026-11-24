import { GovtData } from 'novadatainterface/govt_data';
import { SimulationGameDataInterface } from '../../client/gamedata/simulation_game_data.js';
import { recordHostile, recordIn, statusGovtOf } from './reputation.js';

/**
 * ============================================================================
 * Local law: which legal record makes a ship attack the player (A14)
 * ============================================================================
 *
 * Measured on the original EV Nova (docs/reference_experiments.md, "A14"
 * and "A14 wave 5"; ruling #376, Matthew 2026-11-23). A ship of government
 * G attacks the player on sight for his RECORD exactly when both hold:
 *
 *  1. G ENFORCES in the current system: G owns it, G and the owner are
 *     allied in EITHER direction (G lists one of the owner's classes as an
 *     ally, or the owner lists one of G's — a one-way alliance is enough,
 *     wave 5's c19/c20), or G is nosy (gövt Flags 0x0002,
 *     `attacksPlayerIfCriminal`), which also applies in an independent
 *     system. A govt with no tie to the system ignores the player however
 *     criminal he is there (c4, c10, c15).
 *  2. The player's record IN THE CURRENT SYSTEM is below -G's OWN CrimeTol
 *     (not the owner's: a lenient ally ignores a criminal in a strict
 *     owner's system, c8; a strict ally attacks in a lenient one's, c12).
 *     Records anywhere else, including G's own home systems, never count
 *     (c5, c7, c14, c16, c17).
 *
 * The record is kept PER SYSTEM, as on the original (ruling #380, which
 * ended #376's per-govt simplification): "the record in this system" is the
 * player's record keyed by the current sÿst id, an absent entry reading as
 * the InitialRec of the system's STATUS govt — its owner, or gövt 128 for an
 * independent system (reputation.ts's statusGovtOf, the same reading the
 * map's and the 'p' dialog's "Legal Status:" line make). So all 21 cells
 * hold, c2 included: a criminal in one of the owner's systems is NOT a
 * criminal in its others, except as far as the crime's spread to linked
 * systems reached them (system_records.ts).
 *
 * The political tiers (gövt enemies classes, xenophobic, 0x0004
 * always-attacks, never-attacks, ränk 0x0100) are not this module's
 * business; govt_disposition's govtDispositionTo layers them around it.
 */
export interface LocalLaw {
    /** The current system (sÿst global id): the key of "the player's
     * record in this system". Undefined only when nobody knows where the
     * reader is; the record then reads as the status govt's InitialRec. */
    readonly systemId: string | undefined;
    /** The current system's owning government, or undefined when it is
     * independent (or not known). Decides who ENFORCES here. */
    readonly owner: GovtData | undefined;
    /** The system's STATUS government: statusGovtOf(owner) — the owner,
     * or gövt 128 when independent. */
    readonly recordGovtId: string;
    /** That government's data, for its InitialRec (an absent record entry
     * reads as InitialRec, exactly as everywhere else). */
    readonly recordGovt: GovtData | undefined;
}

/** Whether two class-number lists share any value. */
function intersects(a: readonly number[], b: readonly number[]): boolean {
    return a.some(x => b.includes(x));
}

/**
 * The law in force in the system `systemId`, whose sÿst govt is
 * `systemGovtId` (null or undefined: independent).
 */
export function localLaw(systemId: string | undefined,
    systemGovtId: string | null | undefined,
    getGovt: (id: string) => GovtData | undefined): LocalLaw {
    const owner = systemGovtId ? getGovt(systemGovtId) : undefined;
    const recordGovtId = statusGovtOf(systemGovtId);
    return { systemId, owner, recordGovtId, recordGovt: getGovt(recordGovtId) };
}

/**
 * The law in force in the system `systemId` (a world's SystemIdResource),
 * read from the game data's caches. In the simulation both reads are warm
 * by makeSystem's staging contract (the world's own sÿst, and EVERY gövt),
 * so every peer reaches the same verdict; on the display side a cold cache
 * reads as an independent system for the moment it takes to load.
 */
export function localLawIn(gameData: SimulationGameDataInterface,
    systemId: string | undefined): LocalLaw {
    const systemGovt = systemId
        ? gameData.data.System.getCached(systemId)?.govt : undefined;
    return localLaw(systemId, systemGovt,
        id => gameData.data.Govt.getCached(id));
}

/**
 * localLawIn for an ASYNC display caller (the comm dialog, ship offers):
 * loads the sÿst and the two govts first, so a cold cache cannot read a
 * governed system as independent. Never for the simulation, which must
 * not await data mid-step (its caches are staged; use localLawIn).
 */
export async function loadLocalLaw(gameData: SimulationGameDataInterface,
    systemId: string | undefined): Promise<LocalLaw> {
    const system = systemId
        ? await gameData.data.System.get(systemId).catch(() => undefined)
        : undefined;
    const load = (id: string) =>
        gameData.data.Govt.get(id).catch(() => undefined);
    const owner = system?.govt ? await load(system.govt) : undefined;
    const recordGovtId = statusGovtOf(system?.govt);
    return {
        systemId, owner, recordGovtId, recordGovt: await load(recordGovtId),
    };
}

/**
 * Whether two governments count as allies for the law: the same govt, or
 * either one lists one of the other's classes as an ally. A ONE-WAY
 * alliance is enough (reference "A14 wave 5" c19/c20, for who enforces;
 * piracy police reuse it for whose ships they defend, where only a
 * two-way alliance was measured: "P1 wave 14").
 */
export function alliedEitherWay(a: GovtData, b: GovtData): boolean {
    return a.id === b.id
        || intersects(a.allies, b.classes)
        || intersects(b.allies, a.classes);
}

/** Whether ships of `self` enforce the law of a system owned by `owner`
 * (undefined: independent). Rule 1 above. */
export function enforcesHere(self: GovtData,
    owner: GovtData | undefined): boolean {
    if (self.flags.attacksPlayerIfCriminal) {
        return true;
    }
    return owner !== undefined && alliedEitherWay(self, owner);
}

/** Whether `self` is a system's owner `owner` or allied with it in
 * EITHER direction (a one-way alliance is enough): rule 1 without the
 * nosy flag. The contraband scan's record rule reads it too
 * (npc/contraband.ts's smugglingRecordChange). */
export function alliedWithOwner(self: GovtData, owner: GovtData): boolean {
    return alliedEitherWay(self, owner);
}

/** The player's record in the system `law` is in force in. */
export function recordHere(records: ReadonlyMap<string, number>,
    law: LocalLaw): number {
    return recordIn(records, law.systemId, law.recordGovt);
}

/**
 * Whether ships of `self` count a pilot with `records` as a criminal to
 * attack here: rules 1 and 2 above. Only ships with legal records (player
 * ships) can be criminals.
 */
export function criminalHere(self: GovtData,
    records: ReadonlyMap<string, number>, law: LocalLaw): boolean {
    return enforcesHere(self, law.owner)
        && recordHostile(recordHere(records, law), self.crimeTol);
}
