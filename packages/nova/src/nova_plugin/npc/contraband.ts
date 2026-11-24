import { GovtData } from 'novadatainterface/govt_data';
import { JunkData } from 'novadatainterface/junk_data';
import { OutfitData } from 'novadatainterface/outfit_data';
import { displayName } from '../core/index.js';
import { ActiveMission, Credits, Missions } from '../player/index.js';
import {
    addRecordIn, alliedWithOwner, enforcesHere, LegalRecords, LocalLaw,
} from '../reputation/index.js';
import { Cargo, OutfitsState } from '../ship/index.js';

/**
 * ============================================================================
 * Contraband: what an AI 4 scan finds and what it costs (the pure rules)
 * ============================================================================
 *
 * EVN Bible, AIType 4: the interceptor "buzzes incoming ships to scan them
 * for illegal cargo". Something is illegal to a government when any 1 bit
 * of its gövt ScanMask matches one in the thing's own ScanMask: an oütf
 * (B:2027), a jünk (B:1168) or a mïsn's cargo (B:1364).
 *
 * MEASURED on the original (docs/reference_experiments.md, "S1 / I1 wave
 * 11", "S1 and S2 wave 12" and "Contraband wave 14"; gövt Kit Customs:
 * ScanMask 0x0001, ScanFine 500, SmugPenalty 50, CrimeTol 10):
 *  - an illegal OUTFIT: "<scanner>: <pilot>, your posession of a <item> has
 *    been detected. You have been fined 500 credits." ScanFine is charged
 *    once and the SmugPenalty moves the record of the system the scan
 *    happened in (smugglingRecordChange below). The scanning govt's ships
 *    then attack the pilot until he lands or leaves, whatever its
 *    CrimeTol (contraband_target.ts's `hostile`).
 *  - illegal JÜNK: "<scanner>: <pilot>, your attempt to smuggle <the
 *    jünk's LCName> through this system has been detected. You have been
 *    fined 500 credits." ScanFine AND SmugPenalty, like an outfit.
 *  - illegal cargo of a mission with mïsn Flags 0x0020: "Your ship has
 *    been scanned - mission failed." The mission fails at once; no fine,
 *    no record change. Only a scan that finds THAT mission's cargo
 *    illegal fails it: a ScanMask-0 0x0020 mission (as 51 stock missions
 *    are) survived a scan that found the pilot's pod, and a clean ship
 *    carrying one is never approached (wave 14, S3).
 *  - illegal cargo of an ORDINARY mission: "<scanner>: <pilot>, your
 *    attempt to smuggle illegal cargo through this system has been
 *    detected. You have been fined 500 credits." The mission continues
 *    and there is NO SmugPenalty (the Bible's SmugPenalty text speaks of
 *    mission cargo; the record moved only for the outfit and the jünk).
 *  - ScanFine 0 AND ScanFine -5 alike: the detection line without its
 *    fine sentence, no money taken, SmugPenalty still charged (see
 *    contrabandFine for the Bible's contrary reading of -N).
 *  - a clean ship is not approached, and nothing is said to it.
 *  - SEVERAL FINDS in one scan (wave 15, `w15_several`: the pod, 10 t of
 *    illegal jünk and a Flags 0x0020 mission's illegal cargo): ONE status
 *    line, which named the JÜNK, not the pod; ONE fine; the 0x0020
 *    mission failed with no line of its own.
 *  - an ally of the system's owner scanning charges ITS OWN SmugPenalty
 *    (wave 15, `w15_scan_ally`: -50, not the owner's 70;
 *    smugglingRecordChange).
 *
 * GUESSES (not measured; each is listed for the reference Mac in
 * docs/npc_behavior_gaps.md, "Contraband scan"):
 *  - a mission's cargo is "aboard" once loaded; a mission with no cargo
 *    at all (passengers, an agent, 8 stock missions with a ScanMask) is
 *    illegal for as long as it is active.
 *  - a fine never takes more than the pilot has.
 *  - of several finds, the line names the hold's cargo before an outfit:
 *    the jünk, else a plain mission's "illegal cargo", else the outfit
 *    (status_bar_content.ts's contrabandScanMessage; only jünk over an
 *    outfit was measured). ONE record change (for an outfit or jünk).
 */

// --- Tuning constants (GUESSES: listed for the reference Mac) ---

/** An interceptor notices a ship to scan within this distance of itself.
 * The reference saw a cutter reach a pilot that had just jumped in
 * within about 3 s; the seek range is generous so "incoming ships" are
 * buzzed wherever they arrive. */
export const CONTRABAND_SCAN_SEEK_RANGE = 3000;
/** The scan happens when the interceptor is within this distance of the
 * ship ("a cutter beside the player"). */
export const CONTRABAND_SCAN_RANGE = 150;

/** Whether two ScanMasks share a bit. */
export function scanMaskMatches(govtMask: number, itemMask: number): boolean {
    return (govtMask & itemMask & 0xffff) !== 0;
}

/**
 * Whether ships of `govt` scan for contraband in a system under `law`. A
 * govt with ScanMask 0 considers nothing illegal (Bible: "Set to zero if
 * unused"), so it never scans. GUESS: a scan is law enforcement, so a
 * govt scans only where it ENFORCES (local_law.ts's enforcesHere: its own
 * systems, its allies', and anywhere if it is nosy). The reference
 * measured only the owner's interceptors.
 */
export function scansHere(govt: GovtData | undefined,
    law: LocalLaw): boolean {
    return govt !== undefined && (govt.scanMask & 0xffff) !== 0
        && enforcesHere(govt, law.owner);
}

/** What a scan by a government finds aboard one ship. */
export interface ContrabandFindings {
    /** The first illegal outfit aboard, by sorted outfit id: its id and
     * the lower-case name the status line uses. */
    outfit?: { id: string, name: string };
    /** The first illegal jünk in the hold, by sorted jünk id: its id and
     * the lower-case name the status line uses ("your attempt to smuggle
     * <name> through this system"). */
    junk?: { id: string, name: string };
    /** Illegal cargo of a mission without Flags 0x0020: the "attempt to
     * smuggle illegal cargo" case. */
    smuggled: boolean;
    /** Active missions with Flags 0x0020 whose cargo is illegal here,
     * sorted by id: each fails. */
    failMissions: string[];
    /** EVERY illegal thing found, as sorted keys ("outfit:<id>",
     * "junk:<id>", "mission:<id>"): what the scanned marker remembers, so
     * a later scan in the same visit can tell new contraband from what was
     * already found (contraband_target.ts's needsScan). */
    items: string[];
}

/** The keys in `findings` that are not among `found` (what an earlier
 * scan on this visit found): the contraband NEW since that scan. */
export function newContraband(findings: ContrabandFindings,
    found: readonly string[] | undefined): string[] {
    const known = new Set(found ?? []);
    return findings.items.filter(key => !known.has(key));
}

/** Whether a scan finding `findings` has anything to act on. */
export function hasContraband(findings: ContrabandFindings): boolean {
    return isDetection(findings) || findings.failMissions.length > 0;
}

/** Whether a scan finding `findings` DETECTED something: the fine line
 * ("... has been detected."), as opposed to nothing, or only a failed
 * Flags 0x0020 mission. */
export function isDetection(findings: ContrabandFindings): boolean {
    return findings.outfit !== undefined || findings.junk !== undefined
        || findings.smuggled;
}

/** The lower-case name a scan line gives an outfit: its LCName, else
 * its name (player-facing part) in lower case. */
export function outfitScanName(outfit: OutfitData): string {
    return outfit.lcName?.trim() || displayName(outfit.name).toLowerCase();
}

/** The lower-case name a scan line gives a jünk: its LCName (measured:
 * "kit contraband" for the kit jünk), else its name in lower case. */
export function junkScanName(junk: JunkData): string {
    return junk.lcName?.trim() || displayName(junk.name).toLowerCase();
}

/**
 * Whether an active mission's cargo is illegal to a government with
 * `govtMask` right now: the mïsn ScanMask matches, and the cargo is
 * aboard (a mission that carries no cargo at all is illegal while it is
 * active; guess, see the module comment). A mission already marked
 * failed is out of play.
 */
export function missionIllegal(mission: ActiveMission,
    govtMask: number): boolean {
    if (mission.failed || !mission.scanMask
        || !scanMaskMatches(govtMask, mission.scanMask)) {
        return false;
    }
    return mission.cargoType < 0 || mission.cargoLoaded;
}

/** A ship's possessions, as a scan sees them. */
export interface ScannedHold {
    outfits?: OutfitsState;
    cargo?: Cargo;
    missions?: Missions;
}

/**
 * What a scan by a government with `govtMask` finds in `hold`. The game
 * data is read through the two lookups, which the simulation backs with
 * staged caches (the ship's own outfits are staged with the ship, and
 * every jünk at world genesis), so every peer finds the same thing.
 * Iterates in sorted-id order, so the outfit named is the same on every
 * peer whatever order the maps were filled in.
 */
export function findContraband(govtMask: number, hold: ScannedHold,
    getOutfit: (id: string) => OutfitData | undefined,
    getJunk: (id: string) => JunkData | undefined): ContrabandFindings {
    const findings: ContrabandFindings = {
        smuggled: false, failMissions: [], items: [],
    };
    if ((govtMask & 0xffff) === 0) {
        return findings;
    }
    for (const id of [...(hold.outfits?.keys() ?? [])].sort()) {
        if ((hold.outfits!.get(id)?.count ?? 0) <= 0) {
            continue;
        }
        const outfit = getOutfit(id);
        if (outfit && scanMaskMatches(govtMask, outfit.scanMask)) {
            findings.outfit ??= { id, name: outfitScanName(outfit) };
            findings.items.push(`outfit:${id}`);
        }
    }
    const junkIds = [...(hold.cargo ?? [])]
        .filter(([key, tons]) => tons > 0 && key.startsWith('junk:'))
        .map(([key]) => key.slice('junk:'.length)).sort();
    for (const id of junkIds) {
        const junk = getJunk(id);
        if (junk && scanMaskMatches(govtMask, junk.scanMask)) {
            findings.junk ??= { id, name: junkScanName(junk) };
            findings.items.push(`junk:${id}`);
        }
    }
    for (const id of [...(hold.missions?.keys() ?? [])].sort()) {
        const mission = hold.missions!.get(id)!;
        if (!missionIllegal(mission, govtMask)) {
            continue;
        }
        findings.items.push(`mission:${id}`);
        if (mission.failIfScanned) {
            findings.failMissions.push(id);
        } else {
            findings.smuggled = true;
        }
    }
    findings.items.sort();
    return findings;
}

/**
 * The fine a gövt ScanFine charges a pilot holding `credits`: 1 and up,
 * that amount; 0 AND BELOW, nothing (the detection line goes without its
 * fine sentence). Never more than the pilot has (guess: the original's
 * behaviour with too little cash is not measured).
 *
 * THE ORIGINAL OVER THE BIBLE. The Bible (B:977-985) reads ScanFine -1
 * and below as "fine this percent of the player's cash" (-5 would be
 * 5%). The original 1.1.1 does not: a ScanFine -5 govt detected a pod,
 * printed the line without the fine sentence and took nothing, exactly
 * as ScanFine 0 does (docs/reference_experiments.md, "Contraband wave
 * 14", `w14_percent`). NovaJS follows the original.
 */
export function contrabandFine(scanFine: number, credits: number): number {
    const cash = Math.max(0, Math.floor(credits));
    return scanFine > 0 ? Math.min(Math.floor(scanFine), cash) : 0;
}

/**
 * A govt's SmugPenalty (B:987) as a scan charges it; 0 for no govt. 0 is
 * no penalty: smuggling has no engine default. A NEGATIVE field reads as
 * no penalty too (unmeasured for SmugPenalty; the one stock gövt that
 * writes negatives is the derelict Wraith nova:159, -1. The crime
 * penalties, reputation.ts's crimePenalty, were measured to apply
 * signed).
 */
export function smugglingPenalty(govt: GovtData | undefined): number {
    return govt && govt.smugglePenalty > 0 ? govt.smugglePenalty : 0;
}

/**
 * How a detected illegal outfit or jünk moves the pilot's record of the
 * system the scan happened in: the A14 crime rule with the SCANNER as
 * the "victim" (docs/reference_experiments.md, "Contraband wave 14",
 * finding 7).
 *  - The scanner OWNS the system or is the owner's ally (either
 *    direction, local_law.ts's alliedWithOwner): minus the SCANNER's
 *    SmugPenalty (the customs govts in their own systems: -50).
 *  - Otherwise (a nosy govt scanning in another govt's system): PLUS half
 *    the OWNER's SmugPenalty, truncated (owner SmugPenalty 70: +35; owner
 *    SmugPenalty 0: no change).
 * Smuggling does not spread to linked systems (the nosy scanner's own
 * system, linked to the one it scanned in, did not move), so it is ONE
 * change, to the record of the system the scan happened in (law.systemId;
 * records are per system, ruling #380), unlike a crime's
 * (system_records.ts's applyCrime). When an ALLY of the owner
 * scans, the ally's own SmugPenalty is charged (MEASURED, wave 15,
 * `w15_scan_ally`: -50 where the owner's is 70). GUESS: in an independent
 * system there is no owner, so a nosy scanner's detection changes no
 * record.
 */
export function smugglingRecordChange(scanner: GovtData, law: LocalLaw):
    number {
    if (law.owner && alliedWithOwner(scanner, law.owner)) {
        return -smugglingPenalty(scanner);
    }
    return Math.trunc(smugglingPenalty(law.owner) / 2);
}

/** What a scan did to the scanned pilot, for the status line. */
export interface ContrabandScanResult {
    /** The illegal outfit's lower-case name, when one was found. */
    outfit?: string;
    /** The illegal jünk's lower-case name, when one was found. */
    junk?: string;
    /** Illegal cargo of a plain mission was found. */
    smuggled: boolean;
    /** At least one Flags 0x0020 mission failed. */
    missionFailed: boolean;
    /** Credits taken (0 for a warning, or when only missions failed). */
    fine: number;
}

/**
 * Applies a scan's findings to the scanned pilot's synced state, in
 * place: flagged missions fail, a detection (an outfit, jünk or a plain
 * mission's cargo) costs the govt's ScanFine once, and an outfit or jünk
 * also moves the record of the system the scan happened in (law.systemId,
 * and only that one: smuggling does not spread) by smugglingRecordChange.
 * Pure apart from those mutations; no PRNG.
 */
export function applyContrabandScan(findings: ContrabandFindings,
    scanner: GovtData, law: LocalLaw, pilot: {
        credits?: Credits, records?: LegalRecords, missions?: Missions,
    }): ContrabandScanResult {
    for (const id of findings.failMissions) {
        const mission = pilot.missions?.get(id);
        if (mission && !mission.failed) {
            mission.failed = true;
            mission.failCause = 'scan';
        }
    }
    let fine = 0;
    if (isDetection(findings)) {
        if (pilot.credits) {
            fine = contrabandFine(scanner.scanFine, pilot.credits.credits);
            pilot.credits.credits -= fine;
        }
        const change = smugglingRecordChange(scanner, law);
        if ((findings.outfit || findings.junk) && pilot.records
            && change !== 0 && law.systemId !== undefined) {
            addRecordIn(pilot.records, law.systemId, law.recordGovt,
                change);
        }
    }
    return {
        ...(findings.outfit ? { outfit: findings.outfit.name } : {}),
        ...(findings.junk ? { junk: findings.junk.name } : {}),
        smuggled: findings.smuggled,
        missionFailed: findings.failMissions.length > 0,
        fine,
    };
}
