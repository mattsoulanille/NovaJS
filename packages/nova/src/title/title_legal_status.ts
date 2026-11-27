import { GovtData } from 'novadatainterface/govt_data';
import {
    legalStatusInSystem, statusGovtOf,
} from '../nova_plugin/reputation/index.js';

/** The parts of a save the title's legal line reads. */
export interface TitleLegalSave {
    /** The system the pilot was saved in (its last stellar's). */
    system: string;
    /** Per-system legal records. */
    legalRecords: readonly (readonly [string, number])[];
    /** A v5-or-older save's per-govt records, not yet placed in systems. */
    govtRecords?: readonly (readonly [string, number])[];
}

/**
 * The title screen's "Legal status in current system:" word: the pilot's
 * record in the saved system (`systemGovt` its sÿst govt), read exactly as
 * the in-flight 'p' dialog and the map read it (legalStatusInSystem: an
 * absent record is the status govt's InitialRec, CrimeTol scaled, "N/A"
 * under a xenophobic govt). MEASURED (reference "Combat-rating tiers
 * (R5), wave 41", side finding): a record-0 pilot reads "No Record" there,
 * a lawful one "Citizen"; the title used to hard-code "Citizen".
 *
 * A save written before records were per system still holds per-govt
 * ones (`govtRecords`, placed in systems only when the pilot is entered):
 * the saved system then takes its status govt's old record, as
 * restorePlayerState will seed it. `undefined` when the status govt is
 * unknown (the caller's fallback).
 */
export function titleLegalStatus(save: TitleLegalSave,
    systemGovt: string | null | undefined,
    getGovt: (id: string) => GovtData | undefined): string | undefined {
    const records = new Map(save.legalRecords);
    if (!records.has(save.system)) {
        const old = new Map(save.govtRecords ?? [])
            .get(statusGovtOf(systemGovt));
        if (old !== undefined) {
            records.set(save.system, old);
        }
    }
    return legalStatusInSystem(records, save.system, systemGovt, getGovt);
}
