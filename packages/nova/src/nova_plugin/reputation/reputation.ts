import { GovtData } from 'novadatainterface/govt_data';

/**
 * ============================================================================
 * Legal records and combat ratings: the pure math (EVN Bible)
 * ============================================================================
 *
 * LEGAL RECORD (Bible, gövt section + Appendix II): an integer PER SYSTEM.
 * 0 is neutral, positive is good, negative is "evilness". NovaJS keys a
 * player's records by sÿst global id, as the original does (its pilot file
 * holds one record per system and none per govt: reference "A14 ... wave
 * 13", finding 4; ruling #380, Matthew 2026-11-24, which ended ruling
 * #376's one-record-per-govt simplification). An absent entry reads as the
 * InitialRec of the system's STATUS govt (statusGovtOf: its owner, or gövt
 * 128 when independent), the Bible's "initial legal record in systems
 * controlled by this govt", so a fresh pilot needs no initialization pass.
 *
 * CRIME (Bible, gövt): destroying a ship costs KillPenalty, disabling it
 * DisabPenalty, boarding it BoardPenalty. Measured, a KILL costs
 * DisabPenalty + KillPenalty, also when one hit destroys the ship without a
 * visible disable, and the Disab only once when the same player disabled it
 * first (reference "A14 with system traffic as the victims, wave 12";
 * reputation_plugin.ts's KillCreditSystem). Whose record, and how far it
 * reaches, is system_records.ts's: the crime's system and every system
 * linked to it, scaled 0.65 per jump, each by its own owner's view of the
 * victim — a penalty when the victim is that owner's or an ally's ship, the
 * "Good Citizen" reward of half the owner's own penalties otherwise.
 *
 * The Bible's "allies communicate your actions ... enemies approve" is NOT
 * a govt-wide propagation on the original: an ally's or enemy's home system
 * changes only through the per-jump spread, by its own owner's view
 * (reference "A14 spread, wave 14", finding 3), and an unlinked system of
 * the same owner not at all (wave 5). Allies still CARE: they enforce the
 * record of the system they are in (local_law.ts).
 *
 * Most stock gövts DO set their penalty fields (57 of the 68 stock
 * govts carry a non-zero KillPenalty — the Federation's is 5, the
 * Vell-os' 40), and those values are used as written. A minority
 * (11 stock govts, e.g. Spanner and the Derelicts) leave them at
 * zero, yet the real engine still penalizes crimes against them, so
 * it must have built-in defaults. Those defaults are undocumented;
 * NovaJS substitutes the DEFAULT_* constants below whenever a govt's
 * field is 0.
 *
 * (An earlier revision of this comment claimed stock data leaves
 * EVERY penalty field zero. That was wrong: it was measured with
 * plug-ins loaded, and a plug-in had overwritten the stock gövts.
 * Tests now parse base "Nova Files" only.)
 *
 * HOSTILITY (Bible, gövt CrimeTol): "the maximum amount of evilness
 * the player can accumulate before warships of this govt start to
 * beat on him" — a govt turns hostile when record < -CrimeTol.
 *
 * COMBAT RATING (Bible, Appendix I): "the number of kills you have
 * made, which is the sum of the strengths of all the ships you have
 * destroyed, times some internal multiplier". The multiplier is
 * undocumented; NovaJS uses 1 (raw strength sum), which matches the
 * scale real missions gate on (stock AvailRating values run 1..12800,
 * exactly Appendix I's kill-point tiers).
 */

/** Per-player legal records: sÿst global id (e.g. 'nova:130') -> record
 * (system_records.ts). */
export type LegalRecords = Map<string, number>;

/**
 * Engine-default penalties, used only when a govt's field is 0 (see
 * the module comment). Chosen to sit in the middle of the stock
 * govts' own values — the stock Federation's KillPenalty is likewise
 * 5, so a govt that omits the field behaves like a typical one.
 */
export const DEFAULT_KILL_PENALTY = 5;
export const DEFAULT_DISABLE_PENALTY = 2;
/** Boarding/pirating a ship (boarding_plugin.ts) when the govt leaves
 * BoardPenalty at 0. */
export const DEFAULT_BOARD_PENALTY = 3;

/** Records are int16 in the original pilot file; clamp to its range. */
const RECORD_MIN = -32767;
const RECORD_MAX = 32767;

export function clampRecord(value: number): number {
    return Math.max(RECORD_MIN, Math.min(RECORD_MAX, Math.trunc(value)));
}

/**
 * The player's record in a system: the stored value, else the InitialRec of
 * the system's status govt `statusGovt` (statusGovtOf), else 0 when that
 * govt is unknown.
 */
export function recordIn(records: ReadonlyMap<string, number>,
    systemId: string | undefined, statusGovt?: GovtData): number {
    return (systemId === undefined ? undefined : records.get(systemId))
        ?? statusGovt?.initialRecord ?? 0;
}

/** Adds `delta` to the record in a system, materializing the entry (and
 * clamping it to the pilot file's int16 range). */
export function addRecordIn(records: LegalRecords, systemId: string,
    statusGovt: GovtData | undefined, delta: number): void {
    records.set(systemId,
        clampRecord(recordIn(records, systemId, statusGovt) + delta));
}

function intersects(a: readonly number[], b: readonly number[]): boolean {
    return a.some(x => b.includes(x));
}

/** The kind of crime a legal-record penalty is charged for. */
export type Crime = 'kill' | 'disable' | 'board';

/**
 * A crime's base penalty: the govt's field, SIGNED, or the engine default
 * for a zero field.
 *
 * A NEGATIVE field is applied as written: the crime RAISES the record.
 * Measured (docs/reference_experiments.md, "A14 with system traffic as
 * the victims, wave 12"): one kill of a ship whose govt sets Disab and
 * Kill to -100 raised the record by 200. This replaces #108's "a negative
 * field is no penalty" reading (#320 item 2), which rested on wave 10's
 * "no change" — a run whose victim was a goal-less mission ship, which
 * is no crime at all (wave 11), so it never tested the sign.
 *
 * The one stock gövt that writes negatives is nova:159 "Wraith", the
 * DERELICT variant (Flags 0x0800 "start out disabled"), with -1 in every
 * penalty field: destroying one now raises the Wraith record by 2 (Disab
 * -1 + Kill -1), as the original's arithmetic would.
 */
export function crimePenalty(govt: GovtData, crime: Crime): number {
    const field = crime === 'kill' ? govt.killPenalty
        : crime === 'disable' ? govt.disablePenalty
            : govt.boardPenalty;
    const fallback = crime === 'kill' ? DEFAULT_KILL_PENALTY
        : crime === 'disable' ? DEFAULT_DISABLE_PENALTY
            : DEFAULT_BOARD_PENALTY;
    return field !== 0 ? field : fallback;
}

/**
 * Whether a govt with `crimeTol` treats a player whose record with it
 * is `record` as a criminal to attack (Bible: warships attack once
 * accumulated evilness exceeds the tolerance).
 */
export function recordHostile(record: number, crimeTol: number): boolean {
    return record < -Math.max(0, crimeTol);
}

// --- Mission availability (mïsn AvailRecord / AvailRating) ---

/** AvailRecord sentinel: player has dominated this stellar. */
export const AVAIL_RECORD_DOMINATED_HERE = -32000;
/** AvailRecord sentinel: player has dominated at least one stellar. */
export const AVAIL_RECORD_DOMINATED_ANY = -32001;

/**
 * Whether a record satisfies a mïsn AvailRecord requirement (Bible):
 * 0 ignored; positive = record at least this high; negative = record
 * at least this LOW (criminal missions). The domination sentinels are
 * the caller's business (domination is not implemented).
 */
export function availRecordOk(availRecord: number, record: number): boolean {
    if (availRecord === 0) {
        return true;
    }
    return availRecord > 0 ? record >= availRecord : record <= availRecord;
}

/**
 * Whether a kill-point total satisfies a mïsn AvailRating requirement
 * (Bible: -1 ignored, else rating must be at least this high; stock
 * values are raw Appendix I kill points).
 */
export function availRatingOk(availRating: number, kills: number): boolean {
    return availRating < 0 || kills >= availRating;
}

// --- Combat rating (Appendix I) ---

/**
 * Appendix I's kill-point tiers with the illustrative names (the real
 * strings live in STR# 138, which is not parsed; these match stock).
 */
export const COMBAT_RATING_TIERS: readonly (readonly [number, string])[] = [
    [0, 'No Ability'],
    [1, 'Little Ability'],
    [100, 'Fair Ability'],
    [200, 'Average Ability'],
    [400, 'Good Ability'],
    [800, 'Competent'],
    [1600, 'Very Competent'],
    [3200, 'Worthy of Note'],
    [6400, 'Dangerous'],
    [12800, 'Deadly'],
    [25600, 'Frightening'],
];

/** The Appendix I rating name for a kill-point total. */
export function combatRatingName(kills: number): string {
    let name = COMBAT_RATING_TIERS[0][1];
    for (const [threshold, tierName] of COMBAT_RATING_TIERS) {
        if (kills >= threshold) {
            name = tierName;
        }
    }
    return name;
}

/**
 * The government whose record and CrimeTol judge the player's legal
 * status in an INDEPENDENT system: gövt 128, per the Bible's Appendix
 * II ("if the system is independent, it is based on the first
 * government's [ID 128] crime tolerance"). The same rule keys the
 * record itself (mission_logic's stellarRecord), so status is read
 * from the record and the tolerance of ONE government.
 */
export const INDEPENDENT_STATUS_GOVT = 'nova:128';

/** The government that judges legal status in a system with `systemGovt`. */
export function statusGovtOf(systemGovt: string | null | undefined): string {
    return systemGovt ?? INDEPENDENT_STATUS_GOVT;
}

/**
 * The "Legal Status:" line for a system — the ONE reading shared by the
 * starmap's properties column and the player-info ('p') dialog, so the
 * two can never disagree (#119): the player's record IN THAT SYSTEM
 * (`systemId`, whose sÿst govt is `systemGovt`), against the CrimeTol of
 * its status government (its owner, or gövt 128 for an independent one).
 * An absent record reads as that govt's InitialRec, exactly as the
 * simulation reads it (recordIn) — a fresh pilot in a nova:147 (InitialRec
 * -5) system is not "No Record" on one screen and an offender on the
 * other. Undefined when the status govt is unknown to `getGovt`, which is
 * the caller's "no line" case.
 *
 * A XENOPHOBIC status govt (gövt Flags 0x0001, "Xenophobic (attacks
 * everybody, including the player)") reads {@link LEGAL_STATUS_NOT_APPLICABLE}
 * whatever the record: MEASURED on the map (reference "Map dot colours,
 * wave 23": Kit Map Xeno, gövt 344, "Legal Status: N/A" as a neighbour and
 * as the current system). The 'p' dialog shares this reading, so it says
 * "N/A" there too (unmeasured on that screen).
 */
export function legalStatusInSystem(records: ReadonlyMap<string, number>,
    systemId: string, systemGovt: string | null | undefined,
    getGovt: (id: string) => GovtData | undefined): string | undefined {
    const govt = getGovt(statusGovtOf(systemGovt));
    if (!govt) {
        return undefined;
    }
    if (govt.flags.xenophobic) {
        return LEGAL_STATUS_NOT_APPLICABLE;
    }
    return legalStatusName(recordIn(records, systemId, govt), govt.crimeTol);
}

/** The Legal Status under a xenophobic government (see
 * {@link legalStatusInSystem}), as the original's map prints it. */
export const LEGAL_STATUS_NOT_APPLICABLE = 'N/A';

/**
 * Appendix II's legal-status ladder, in units of the government's
 * CrimeTol: "enough 'good' or 'evil' points to equal the government's
 * crime tolerance is given a value of 1". Each tier is [threshold,
 * name] and applies when the scaled record is STRICTLY above the
 * threshold (the Bible writes every row as ">n").
 *
 * The strings are stock STR# 134 verbatim (indices 10-15 for the good
 * scale, 1-9 for the evil one; 0 is "No Record" and 16-17 the
 * domination titles) — checked against the parsed resource in
 * reputation_integration_test.ts, so the constants here, which the
 * simulation-side modules can reach without game data, cannot drift
 * from the data.
 */
export const LEGAL_STATUS_NO_RECORD = 'No Record';
export const LEGAL_STATUS_GOOD_TIERS: readonly (readonly [number, string])[] = [
    [0, 'Citizen'],
    [4, 'Good Citizen'],
    [16, 'Upstanding Citizen'],
    [64, 'Leading Citizen'],
    [256, 'Model Citizen'],
    [1024, 'Virtuous Citizen'],
];
export const LEGAL_STATUS_EVIL_TIERS: readonly (readonly [number, string])[] = [
    [0, 'No Convictions'],
    [1, 'Minor Offender'],
    [4, 'Offender'],
    [16, 'Criminal'],
    [64, 'Wanted Criminal'],
    [256, 'Fugitive'],
    [1024, 'Hunted Fugitive'],
    [4096, 'Public Enemy'],
];

/**
 * The "Legal Status:" name for a legal record with a government — the
 * ONE implementation behind both the starmap's system readout and the
 * player-info ('p') dialog, so the two can never disagree (#119).
 *
 * EVN Bible, Appendix II: "Your legal status in a system is based on
 * the crime tolerance of that system's government. (if the system is
 * independent, it is based on the first government's [ID 128] crime
 * tolerance) On this scale, enough 'good' or 'evil' points to equal
 * the government's crime tolerance is given a value of 1", then the
 * power-of-four ladders above. The independent-system rule is the
 * CALLER's: pass gövt 128's CrimeTol (mission_logic's stellarRecord
 * already keys the record itself that way; legalStatusInSystem above
 * does both for the map and the 'p' dialog).
 *
 * A CrimeTol of 0 (stock nova:171 Spanner, nova:183 Hypergate, and the
 * scenery govts) would divide by zero; it is read as 1 — every point
 * counts in full, which is also what "no tolerance" means for the
 * hostility test (recordHostile clamps the same way). The evil scale's
 * "Minor Offender" step (>1) therefore coincides exactly with the
 * moment warships open fire (record < -CrimeTol): a "No Convictions"
 * pilot is still within tolerance, a "Minor Offender" is not.
 */
export function legalStatusName(record: number, crimeTol: number): string {
    if (record === 0) {
        return LEGAL_STATUS_NO_RECORD;
    }
    const scaled = Math.abs(record) / Math.max(1, crimeTol);
    const tiers = record > 0
        ? LEGAL_STATUS_GOOD_TIERS : LEGAL_STATUS_EVIL_TIERS;
    let name = tiers[0][1];
    for (const [threshold, tierName] of tiers) {
        if (scaled > threshold) {
            name = tierName;
        }
    }
    return name;
}

// --- mïsn PayVal decoding ---

/** A decoded mïsn PayVal (Bible's positive/negative encodings). */
export type PayValEffect =
    | { type: 'none' }
    | { type: 'credits', amount: number }
    /** Clean the record with a govt (resource id), scoped per Bible. */
    | { type: 'cleanRecord', govtResourceId: number,
        scope: 'govt' | 'allies' | 'classmates' }
    /** Take this percent of the player's cash on completion. */
    | { type: 'takePercent', percent: number }
    /** Take this many credits at mission START (Bible: -50000 = 0). */
    | { type: 'takeCredits', amount: number };

/**
 * Decodes a mïsn PayVal per the Bible:
 *   0 / -1              no pay
 *   1 and up            credits
 *   -10128..-10383      clean record with govt (id = -PayVal - 10000)
 *   -20128..-20383      ...and its allies
 *   -30128..-30383      ...and its classmates
 *   -40001..-40099      take this % of the player's cash
 *   -50000 and down     take (-PayVal - 50000) credits at mission start
 * Values outside every documented range decode to 'none'.
 */
export function decodePayVal(payVal: number): PayValEffect {
    if (payVal > 0) {
        return { type: 'credits', amount: payVal };
    }
    if (payVal >= -10000) {
        // 0, -1, and anything else above the encoded ranges.
        return { type: 'none' };
    }
    if (payVal >= -10383 && payVal <= -10128) {
        return { type: 'cleanRecord', govtResourceId: -payVal - 10000,
            scope: 'govt' };
    }
    if (payVal >= -20383 && payVal <= -20128) {
        return { type: 'cleanRecord', govtResourceId: -payVal - 20000,
            scope: 'allies' };
    }
    if (payVal >= -30383 && payVal <= -30128) {
        return { type: 'cleanRecord', govtResourceId: -payVal - 30000,
            scope: 'classmates' };
    }
    if (payVal >= -40099 && payVal <= -40001) {
        return { type: 'takePercent', percent: -payVal - 40000 };
    }
    if (payVal <= -50000) {
        return { type: 'takeCredits', amount: -payVal - 50000 };
    }
    return { type: 'none' };
}

// --- mïsn CompGovt / CompReward ---

/**
 * How a mission with a CompGovt ended, for its record change:
 *  - 'complete': at its return stellar;
 *  - 'timeout': its TimeLimit ran out (the deadline passed);
 *  - 'scanned': a Flags 0x0020 mission's cargo was found by a contraband
 *    scan (ActiveMission.failCause 'scan');
 *  - 'fail': any other failure (an Fxxx set string, the owner disabled or
 *    destroyed under Flags2 0x0004, boarded by pirates under Flags
 *    0x8000, a ship goal made unachievable);
 *  - 'abort': the player aborted it.
 */
export type MissionOutcome =
    'complete' | 'timeout' | 'scanned' | 'fail' | 'abort';

/**
 * The record change for a mission outcome with a CompGovt (Bible):
 * completion grants the full CompReward; failure costs half ("that
 * govt will take it personally"), truncated; abort costs 5x when the
 * mïsn lose5xCompRewardOnAbort flag (0x0040) is set, else nothing.
 *
 * A TIMEOUT costs NOTHING, against the Bible: on the original a mission
 * that failed on its TimeLimit (CompReward 1000) changed no record
 * anywhere, not -500 with the CompGovt nor anything with its allies,
 * enemies or the xenophobes (reference "A14 / contraband wave 15",
 * finding 2). Neither does a SCAN failure: a Flags 0x0020 mission failed
 * by a contraband scan (CompReward 10) changed no record either
 * (reference "S1 and S2 wave 12", S2). The other failure kinds keep the
 * Bible's -R/2 for now: they were not measured.
 */
export function compRewardDelta(compReward: number,
    outcome: MissionOutcome, lose5xOnAbort = false): number {
    switch (outcome) {
        case 'complete': return compReward;
        case 'timeout': return 0;
        case 'scanned': return 0;
        case 'fail': return -Math.trunc(compReward / 2);
        case 'abort': return lose5xOnAbort ? -5 * compReward : 0;
    }
}

/**
 * How two govts stand for the record changes that reach past one govt
 * (chär starting statuses, a completed mission's CompReward): allied
 * when EITHER lists the other's class among its allies, else enemies
 * when either lists the other's class among its enemies, else neutral.
 * Symmetric, unlike govtDisposition (an acting ship's one-sided view).
 *
 * Either-direction is measured: with stock data, Rescue Raczak's
 * CompReward 10 for gövt 144 Wild Geese changed +5 in exactly the 173
 * systems this rule calls allied and -5 in exactly the 121 it calls
 * enemy (reference "Boarding a rescue ship: stock "Rescue Raczak"
 * (nova:394), wave 13", finding 4); 144's own ally and enemy lists
 * alone would give 93 and 113.
 */
export function govtRelation(a: GovtData, b: GovtData):
    'ally' | 'enemy' | 'neutral' {
    if (intersects(a.allies, b.classes) || intersects(b.allies, a.classes)) {
        return 'ally';
    }
    if (intersects(a.enemies, b.classes) || intersects(b.enemies, a.classes)) {
        return 'enemy';
    }
    return 'neutral';
}

