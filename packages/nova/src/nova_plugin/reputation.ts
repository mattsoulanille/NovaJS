import { GovtData } from 'novadatainterface/govt_data';

/**
 * ============================================================================
 * Legal records and combat ratings: the pure math (EVN Bible)
 * ============================================================================
 *
 * LEGAL RECORD (Bible, gövt section + Appendix II): an integer per
 * government. 0 is neutral, positive is good, negative is "evilness".
 * NovaJS keys records by gövt id; the original game keys them by
 * SYSTEM, seeded from the system owner's InitialRec — the per-govt
 * model is the sanctioned simplification (one record per polity
 * instead of per star), and it is what the save schema reserved.
 *
 * A govt whose record is absent from the map reads as its InitialRec
 * (the Bible's starting record), so fresh pilots need no per-govt
 * initialization pass.
 *
 * CRIME AND PROPAGATION (Bible, gövt): destroying a govt's ship adds
 * KillPenalty evilness with that govt, disabling adds DisabPenalty
 * (boarding/smuggling: BoardPenalty/SmugPenalty — not wired yet).
 * "Doing evil deeds to one government will improve your rating with
 * its enemies, and vice versa. Allied governments also communicate
 * your actions, so attacking one government will make its allies hate
 * you too." The Bible does not give the ally/enemy fractions; NovaJS
 * uses half the penalty, truncated (see PROPAGATION_DIVISOR).
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

/** Per-player legal records: gövt global id (e.g. 'nova:128') -> record. */
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

/**
 * Ally/enemy propagation: allies of the wronged govt apply the penalty
 * divided by this (truncated); enemies credit the same amount. A
 * NovaJS judgment call — the Bible documents the propagation but not
 * its magnitude.
 */
export const PROPAGATION_DIVISOR = 2;

/** Records are int16 in the original pilot file; clamp to its range. */
const RECORD_MIN = -32767;
const RECORD_MAX = 32767;

function clampRecord(value: number): number {
    return Math.max(RECORD_MIN, Math.min(RECORD_MAX, Math.trunc(value)));
}

/**
 * The player's record with a govt: the stored value, else the govt's
 * InitialRec, else 0 for an unknown govt.
 */
export function recordWith(records: ReadonlyMap<string, number>,
    govtId: string, govtData?: GovtData): number {
    return records.get(govtId) ?? govtData?.initialRecord ?? 0;
}

/** Adds `delta` to the record with `govt`, materializing the entry. */
export function addRecord(records: LegalRecords, govtId: string,
    govtData: GovtData | undefined, delta: number): void {
    records.set(govtId,
        clampRecord(recordWith(records, govtId, govtData) + delta));
}

function intersects(a: readonly number[], b: readonly number[]): boolean {
    return a.some(x => b.includes(x));
}

/** The kind of crime a legal-record penalty is charged for. */
export type Crime = 'kill' | 'disable' | 'board';

/**
 * A crime's base penalty: the govt's field, or the engine default for a
 * zero field — and NO PENALTY AT ALL for a negative one.
 *
 * The Bible describes every penalty field as "the amount of evilness"
 * a crime earns and never gives a negative one a meaning, while "-1
 * means unused" is the format's convention everywhere else (SalaryCap,
 * AvailRating, the -1 ids). Exactly one stock gövt writes negatives:
 * nova:159 "Wraith" — the DERELICT variant (Flags 0x0800 "start out
 * disabled", can't be hailed, no assistance or mercy) — sets Smug,
 * Disab, Board, Kill AND the "currently ignored" ShootPenalty all to
 * -1, the copy-paste signature of "not applicable" rather than of a
 * bounty; its living siblings nova:138/139 charge a KillPenalty of 16.
 * Read literally (record -= -1) a pilot would be REWARDED a point of
 * Wraith standing for shooting a derelict, and read as "unset -> engine
 * default" they would be charged as for a typical govt; neither is what
 * that author meant. So a negative field is "this govt does not care":
 * the crime costs nothing and propagates nothing (#108).
 */
export function crimePenalty(govt: GovtData, crime: Crime): number {
    const field = crime === 'kill' ? govt.killPenalty
        : crime === 'disable' ? govt.disablePenalty
            : govt.boardPenalty;
    const fallback = crime === 'kill' ? DEFAULT_KILL_PENALTY
        : crime === 'disable' ? DEFAULT_DISABLE_PENALTY
            : DEFAULT_BOARD_PENALTY;
    if (field < 0) {
        return 0;
    }
    return field !== 0 ? field : fallback;
}

/**
 * Applies a crime against `victimGovt` to `records`: the full penalty
 * with the victim's govt, minus the propagated fraction with its
 * allies, plus the same fraction with its enemies (Bible: allies
 * communicate your actions; enemies approve). `allGovts` is iterated
 * in the given order — callers must supply a deterministically ordered
 * collection when this runs in the simulation.
 */
export function applyCrime(records: LegalRecords, victimGovt: GovtData,
    crime: Crime,
    allGovts: Iterable<readonly [string, GovtData]>): void {
    const penalty = crimePenalty(victimGovt, crime);
    if (penalty === 0) {
        return; // A govt that does not care (negative field): no entry.
    }
    addRecord(records, victimGovt.id, victimGovt, -penalty);
    const propagated = Math.trunc(penalty / PROPAGATION_DIVISOR);
    if (propagated === 0) {
        return;
    }
    for (const [id, govt] of allGovts) {
        if (id === victimGovt.id) {
            continue;
        }
        let delta = 0;
        // Relations are evaluated from the onlooker's side, like
        // govtDisposition: an "ally of the victim" is a govt whose
        // ally classes include one of the victim's classes.
        if (intersects(govt.allies, victimGovt.classes)) {
            delta -= propagated;
        }
        if (intersects(govt.enemies, victimGovt.classes)) {
            delta += propagated;
        }
        if (delta !== 0) {
            addRecord(records, id, govt, delta);
        }
    }
}

/**
 * Whether a govt with `crimeTol` treats a player whose record with it
 * is `record` as a criminal to attack (Bible: warships attack once
 * accumulated evilness exceeds the tolerance).
 */
export function recordHostile(record: number, crimeTol: number): boolean {
    return record < -Math.max(0, crimeTol);
}

/**
 * Cleans (raises to at least 0) the record with one govt, and per
 * `scope` also with its allies or classmates. Used by the mïsn PayVal
 * -10xxx/-20xxx/-30xxx encodings and oütf ModType 21. Never lowers a
 * good record. Scope 'all' cleans every govt (ModType 21 ModVal -1).
 */
export function cleanRecords(records: LegalRecords,
    scope: 'govt' | 'allies' | 'classmates' | 'all',
    govtData: GovtData | undefined,
    allGovts: Iterable<readonly [string, GovtData]>): void {
    const clean = (id: string, data: GovtData | undefined) => {
        const current = recordWith(records, id, data);
        if (current < 0) {
            records.set(id, 0);
        }
    };
    if (scope === 'all') {
        for (const [id, govt] of allGovts) {
            clean(id, govt);
        }
        return;
    }
    if (!govtData) {
        return;
    }
    clean(govtData.id, govtData);
    if (scope === 'govt') {
        return;
    }
    for (const [id, govt] of allGovts) {
        if (id === govtData.id) {
            continue;
        }
        const related = scope === 'allies'
            // The named govt's allies: govts whose classes intersect
            // its ally class numbers.
            ? intersects(govtData.allies, govt.classes)
            : intersects(govtData.classes, govt.classes);
        if (related) {
            clean(id, govt);
        }
    }
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
 * two can never disagree (#119): the player's record with the system's
 * status government (its own, or gövt 128 for an independent one),
 * against that government's CrimeTol. An absent record reads as the
 * govt's InitialRec, exactly as the simulation reads it (recordWith) —
 * a fresh pilot in a nova:147 (InitialRec -5) system is not "No Record"
 * on one screen and an offender on the other. Undefined when the status
 * govt is unknown to `getGovt`, which is the caller's "no line" case.
 */
export function legalStatusInSystem(records: ReadonlyMap<string, number>,
    systemGovt: string | null | undefined,
    getGovt: (id: string) => GovtData | undefined): string | undefined {
    const govtId = statusGovtOf(systemGovt);
    const govt = getGovt(govtId);
    if (!govt) {
        return undefined;
    }
    return legalStatusName(recordWith(records, govtId, govt), govt.crimeTol);
}

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
 * The record change for a mission outcome with a CompGovt (Bible):
 * completion grants the full CompReward; failure costs half ("that
 * govt will take it personally"), truncated; abort costs 5x when the
 * mïsn lose5xCompRewardOnAbort flag (0x0040) is set, else nothing.
 */
export function compRewardDelta(compReward: number,
    outcome: 'complete' | 'fail' | 'abort',
    lose5xOnAbort = false): number {
    switch (outcome) {
        case 'complete': return compReward;
        case 'fail': return -Math.trunc(compReward / 2);
        case 'abort': return lose5xOnAbort ? -5 * compReward : 0;
    }
}

// --- chär starting statuses ---

/**
 * Builds a fresh pilot's records from chär Govt1-4/Status1-4 (Bible:
 * the status applies to the govt and its allies, and the NEGATIVE of
 * the status to its enemies).
 */
export function initialRecordsFromGovtStatuses(
    statuses: readonly { govt: string, status: number }[],
    allGovts: Iterable<readonly [string, GovtData]>): LegalRecords {
    const records: LegalRecords = new Map();
    const govts = [...allGovts];
    for (const { govt: govtId, status } of statuses) {
        const named = govts.find(([id]) => id === govtId)?.[1];
        records.set(govtId, clampRecord(status));
        if (!named) {
            continue;
        }
        for (const [id, other] of govts) {
            if (id === govtId) {
                continue;
            }
            if (intersects(other.allies, named.classes)
                || intersects(named.allies, other.classes)) {
                records.set(id, clampRecord(status));
            } else if (intersects(other.enemies, named.classes)
                || intersects(named.enemies, other.classes)) {
                records.set(id, clampRecord(-status));
            }
        }
    }
    return records;
}
