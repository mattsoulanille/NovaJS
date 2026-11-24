import { GovtData } from 'novadatainterface/govt_data';
import { JunkData } from 'novadatainterface/junk_data';
import { OutfitData } from 'novadatainterface/outfit_data';
import { displayName } from '../core/index.js';
import { ActiveMission, Credits, Missions } from '../player/index.js';
import {
    addRecord, enforcesHere, LegalRecords, LocalLaw,
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
 * 11" and "S1 and S2 wave 12"; gövt Kit Customs: ScanMask 0x0001,
 * ScanFine 500, SmugPenalty 50, CrimeTol 10):
 *  - an illegal OUTFIT: "<scanner>: <pilot>, your posession of a <item> has
 *    been detected. You have been fined 500 credits." ScanFine is charged
 *    once and SmugPenalty comes off the record of the system the scan
 *    happened in. (50 against CrimeTol 10 made the cutters attack; that
 *    is the ordinary criminal rule, local_law.ts, not part of the scan.)
 *  - illegal cargo of a mission with mïsn Flags 0x0020: "Your ship has
 *    been scanned - mission failed." The mission fails at once; no fine,
 *    no record change.
 *  - illegal cargo of an ORDINARY mission: "<scanner>: <pilot>, your
 *    attempt to smuggle illegal cargo through this system has been
 *    detected. You have been fined 500 credits." The mission continues
 *    and there is NO SmugPenalty (the Bible's SmugPenalty text speaks of
 *    mission cargo; the record moved only for the outfit).
 *  - a clean ship is not approached, and nothing is said to it.
 *
 * GUESSES (not measured; each is listed for the reference Mac in
 * docs/npc_behavior_gaps.md, "Contraband scan"):
 *  - illegal JÜNK is cargo: it reads like an ordinary mission's illegal
 *    cargo (the "attempt to smuggle" line, ScanFine, no SmugPenalty).
 *  - a 0x0020 mission fails only on a scan that FINDS its cargo illegal
 *    (S3). The interceptor never approaches a ship it finds clean, so a
 *    "scan" that finds nothing never happens. 51 stock 0x0020 missions
 *    have ScanMask 0 and so can never be failed by a scan under this
 *    reading.
 *  - a mission's cargo is "aboard" once loaded; a mission with no cargo
 *    at all (passengers, an agent, 8 stock missions with a ScanMask) is
 *    illegal for as long as it is active.
 *  - ScanFine 0 is the Bible's "no fine, just a warning": the detection
 *    line without its fine sentence, and an outfit's SmugPenalty is
 *    still charged. ScanFine -N fines N% of the pilot's cash (Bible).
 *    A fine never takes more than the pilot has.
 *  - one scan can find several things: every flagged mission fails, ONE
 *    fine is charged, and the line names the outfit when there is one.
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
    /** Illegal jünk, or illegal cargo of a mission without Flags 0x0020:
     * the "attempt to smuggle illegal cargo" case. */
    smuggled: boolean;
    /** Active missions with Flags 0x0020 whose cargo is illegal here,
     * sorted by id: each fails. */
    failMissions: string[];
}

/** Whether a scan finding `findings` has anything to act on. */
export function hasContraband(findings: ContrabandFindings): boolean {
    return findings.outfit !== undefined || findings.smuggled
        || findings.failMissions.length > 0;
}

/** The lower-case name a scan line gives an outfit: its LCName, else
 * its name (player-facing part) in lower case. */
export function outfitScanName(outfit: OutfitData): string {
    return outfit.lcName?.trim() || displayName(outfit.name).toLowerCase();
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
    const findings: ContrabandFindings = { smuggled: false, failMissions: [] };
    if ((govtMask & 0xffff) === 0) {
        return findings;
    }
    for (const id of [...(hold.outfits?.keys() ?? [])].sort()) {
        if ((hold.outfits!.get(id)?.count ?? 0) <= 0) {
            continue;
        }
        const outfit = getOutfit(id);
        if (outfit && scanMaskMatches(govtMask, outfit.scanMask)) {
            findings.outfit = { id, name: outfitScanName(outfit) };
            break;
        }
    }
    for (const [key, tons] of hold.cargo ?? []) {
        if (tons > 0 && key.startsWith('junk:')) {
            const junk = getJunk(key.slice('junk:'.length));
            if (junk && scanMaskMatches(govtMask, junk.scanMask)) {
                findings.smuggled = true;
                break;
            }
        }
    }
    for (const id of [...(hold.missions?.keys() ?? [])].sort()) {
        const mission = hold.missions!.get(id)!;
        if (!missionIllegal(mission, govtMask)) {
            continue;
        }
        if (mission.failIfScanned) {
            findings.failMissions.push(id);
        } else {
            findings.smuggled = true;
        }
    }
    return findings;
}

/**
 * The fine a gövt ScanFine charges a pilot holding `credits` (Bible
 * B:977-985): 1 and up, that amount; 0, nothing ("just a warning"); -1
 * and below, that percent of the pilot's cash (-5 is 5%), rounded down.
 * Never more than the pilot has (guess: the original's behaviour with too
 * little cash is not measured).
 */
export function contrabandFine(scanFine: number, credits: number): number {
    const cash = Math.max(0, Math.floor(credits));
    if (scanFine > 0) {
        return Math.min(Math.floor(scanFine), cash);
    }
    if (scanFine < 0) {
        return Math.floor(cash * Math.min(100, -scanFine) / 100);
    }
    return 0;
}

/**
 * The record a detected illegal outfit costs (gövt SmugPenalty, B:987).
 * Negative is "this govt does not care", as for every other penalty
 * field (reputation.ts's crimePenalty; stock nova:159 derelict Wraith
 * writes -1), and 0 is no penalty: smuggling has no engine default.
 */
export function smugglingPenalty(govt: GovtData): number {
    return govt.smugglePenalty > 0 ? govt.smugglePenalty : 0;
}

/** What a scan did to the scanned pilot, for the status line. */
export interface ContrabandScanResult {
    /** The illegal outfit's lower-case name, when one was found. */
    outfit?: string;
    /** Illegal cargo (jünk, or a plain mission's) was found. */
    smuggled: boolean;
    /** At least one Flags 0x0020 mission failed. */
    missionFailed: boolean;
    /** Credits taken (0 for a warning, or when only missions failed). */
    fine: number;
}

/**
 * Applies a scan's findings to the scanned pilot's synced state, in
 * place: flagged missions fail, an outfit or smuggled cargo costs the
 * govt's ScanFine once, and an outfit also costs its SmugPenalty off the
 * record of the system the scan happened in (law.recordGovtId: the
 * system's status govt, the per-govt stand-in for the original's
 * per-system record, as local_law.ts reads it). Pure apart from those
 * mutations; no PRNG.
 */
export function applyContrabandScan(findings: ContrabandFindings,
    scanner: GovtData, law: LocalLaw, pilot: {
        credits?: Credits, records?: LegalRecords, missions?: Missions,
    }): ContrabandScanResult {
    for (const id of findings.failMissions) {
        const mission = pilot.missions?.get(id);
        if (mission && !mission.failed) {
            mission.failed = true;
        }
    }
    let fine = 0;
    if (findings.outfit || findings.smuggled) {
        if (pilot.credits) {
            fine = contrabandFine(scanner.scanFine, pilot.credits.credits);
            pilot.credits.credits -= fine;
        }
        const penalty = smugglingPenalty(scanner);
        if (findings.outfit && pilot.records && penalty > 0) {
            addRecord(pilot.records, law.recordGovtId, law.recordGovt,
                -penalty);
        }
    }
    return {
        ...(findings.outfit ? { outfit: findings.outfit.name } : {}),
        smuggled: findings.smuggled,
        missionFailed: findings.failMissions.length > 0,
        fine,
    };
}
