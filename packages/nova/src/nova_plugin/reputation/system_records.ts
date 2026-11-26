import { GovtData } from 'novadatainterface/govt_data';
import { alliedEitherWay } from './local_law.js';
import {
    addRecordIn, clampRecord, Crime, crimePenalty, govtRelation, LegalRecords,
    recordIn, statusGovtOf,
} from './reputation.js';

/**
 * ============================================================================
 * Per-system legal records: the map they live on, and every rule that
 * writes more than one system (reference A14, ruling #380)
 * ============================================================================
 *
 * The player's legal record is kept PER SYSTEM, as the original keeps it
 * (reference "A14 ... wave 13", finding 4: the pilot file holds no per-govt
 * record at all; ruling #380, Matthew 2026-11-24, option 1). A record map
 * is keyed by sÿst global id; an absent entry reads as the InitialRec of the
 * system's STATUS govt — its owner, or gövt 128 when it is independent
 * (reputation.ts's statusGovtOf, the Bible's Appendix II rule) — which is
 * the Bible's "the player's initial legal record in systems controlled by
 * this govt".
 *
 * A CRIME (a kill, a disable, a boarding) in system S changes the record of
 * every system T that S reaches over hyperlinks, n jumps away (n = 0 for S
 * itself), each from T's OWN status govt's point of view (reference "A14
 * spread, wave 14", the rule that fits all 17 measured values to the unit,
 * with wave 13's four):
 *
 *   - every penalty field the crime charges is scaled first by 0.65^n and
 *     truncated, field by field (scaledPenalty);
 *   - when the victim's govt IS T's owner or an ally of it (either
 *     direction, local_law's alliedEitherWay), T's record falls by the
 *     VICTIM's scaled fields;
 *   - otherwise (an unrelated govt, or T's owner's enemy) T's record RISES
 *     by half of T's OWNER's scaled fields, each field halved and
 *     truncated: the "Good Citizen" reward of #379 (reference "A14 with
 *     system traffic as the victims, wave 12": +9 and +65, wave 13: +17);
 *   - and when T has NO owner (an independent system), T's record FALLS by
 *     a quarter of the VICTIM's scaled fields, each halved twice and
 *     truncated (reference "A14 / contraband wave 16", finding 1: -76 and
 *     -49 one and two jumps out, wave 15's -20: three exact values). Not
 *     gövt 128's view, though gövt 128 still gives an independent system
 *     its InitialRec and CrimeTol.
 *
 * How far: no cut-off was found (+301 six jumps out with an 8000 field);
 * the walk covers every reachable system and stops mattering when every
 * scaled field truncates to 0. Only HYPERLINKS count: systems reached only
 * through a hypergate or a wormhole changed nothing (wave 14, finding 4).
 * And the walk goes by MAP POSITION, not sÿst id: a system that sits at a
 * linked system's coordinates counts as linked too, and passes the spread
 * on through its own links (reference "A14 / contraband wave 15", the side
 * finding). Stock data stacks 270 of its 545 systems on 128 shared
 * positions (story variants of one place under exclusive Visibility
 * bits), so this is what keeps a record the same across a story change of
 * a system: both variants are the same place, 0 jumps apart.
 *
 * NOT by jumps (measured): a mission's CompReward is GOVT-wide — every
 * system of the CompGovt, however far (applyCompletionReward,
 * applyGovtRecordChange) — and a contraband scan's SmugPenalty changes the
 * current system alone (npc/contraband.ts). The PayVal / oütf ModType 21
 * record cleaning and the chär starting statuses are worded by govt in
 * the Bible and work on the systems each govt owns.
 */

/** What the record rules need to know about one sÿst. */
export interface LawSystem {
    readonly id: string;
    /** The owning gövt's global id, or null when independent. */
    readonly govt: string | null;
    /** The sÿst's hyperlinks (global ids; unknown ids are ignored). */
    readonly links: readonly string[];
    /** Map coordinates: the spread treats one position as one place. */
    readonly position: readonly [number, number];
}

/** A LawSystem from anything sÿst-shaped (SystemData, a spec literal). */
export function lawSystemOf(system: {
    id: string, govt?: string | null, links: readonly string[],
    position: readonly [number, number],
}): LawSystem {
    return {
        id: system.id,
        govt: system.govt ?? null,
        links: [...system.links],
        position: [system.position[0], system.position[1]],
    };
}

function byId(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Every system and every govt of the scenario, for the record rules that
 * reach past the current system. Immutable game data, held in SORTED id
 * order so every walk over it is the same on every peer; the simulation
 * builds one at genesis (make_system.ts's LegalGeographyResource), the
 * spaceport from its MissionUniverse.
 *
 * The jump table from a system is computed on first use and kept: a pure
 * function of the data, so caching it cannot fork two peers.
 */
export class LegalGeography {
    /** Every system id, sorted. */
    readonly systemIds: readonly string[];
    private readonly systemsById: ReadonlyMap<string, LawSystem>;
    private readonly govtsById: ReadonlyMap<string, GovtData>;
    private readonly jumpTables = new Map<string, ReadonlyMap<string, number>>();
    private places?: {
        placeOf: Map<string, string>,
        systemsAt: Map<string, string[]>,
    };

    constructor(systems: Iterable<LawSystem>,
        govts: Iterable<readonly [string, GovtData]>) {
        const sorted = [...systems].sort((a, b) => byId(a.id, b.id));
        this.systemsById = new Map(sorted.map(system => [system.id, system]));
        this.systemIds = sorted.map(system => system.id);
        this.govtsById = new Map([...govts].sort(([a], [b]) => byId(a, b)));
    }

    system(id: string): LawSystem | undefined {
        return this.systemsById.get(id);
    }

    govt(id: string): GovtData | undefined {
        return this.govtsById.get(id);
    }

    /** Every govt, in sorted id order. */
    govts(): Iterable<readonly [string, GovtData]> {
        return this.govtsById;
    }

    /** The system's owning govt; undefined when independent or unknown. */
    owner(systemId: string): GovtData | undefined {
        const govt = this.systemsById.get(systemId)?.govt;
        return govt ? this.govtsById.get(govt) : undefined;
    }

    /** The govt whose InitialRec and CrimeTol judge the record in a
     * system: its owner, or gövt 128 when independent (or unknown). */
    statusGovtId(systemId: string): string {
        return statusGovtOf(this.systemsById.get(systemId)?.govt);
    }

    statusGovt(systemId: string): GovtData | undefined {
        return this.govtsById.get(this.statusGovtId(systemId));
    }

    /** The player's record in a system (absent: its InitialRec). */
    recordIn(records: ReadonlyMap<string, number>, systemId: string): number {
        return recordIn(records, systemId, this.statusGovt(systemId));
    }

    /** Adds `delta` to the record in a system, materializing the entry. */
    addRecord(records: LegalRecords, systemId: string, delta: number): void {
        addRecordIn(records, systemId, this.statusGovt(systemId), delta);
    }

    /**
     * Hyperlink jumps from `from` to every system it reaches, walking the
     * map by POSITION (see the module comment): systems sharing a position
     * are one place, a place links wherever any of its systems links, and
     * every system at a place is that place's jump count away. In sorted
     * system id order. A system this geography does not know reaches only
     * itself, at 0.
     */
    jumpsFrom(from: string): ReadonlyMap<string, number> {
        const cached = this.jumpTables.get(from);
        if (cached) {
            return cached;
        }
        const { placeOf, systemsAt } = this.placeIndex();
        const start = placeOf.get(from);
        let table: ReadonlyMap<string, number>;
        if (start === undefined) {
            table = new Map([[from, 0]]);
        } else {
            const distance = new Map<string, number>([[start, 0]]);
            let frontier = [start];
            for (let n = 1; frontier.length > 0; n++) {
                const next: string[] = [];
                for (const place of frontier) {
                    for (const systemId of systemsAt.get(place) ?? []) {
                        for (const link of this.systemsById.get(systemId)!.links) {
                            const linked = placeOf.get(link);
                            if (linked !== undefined && !distance.has(linked)) {
                                distance.set(linked, n);
                                next.push(linked);
                            }
                        }
                    }
                }
                frontier = next;
            }
            const result = new Map<string, number>();
            for (const systemId of this.systemIds) {
                const n = distance.get(placeOf.get(systemId)!);
                if (n !== undefined) {
                    result.set(systemId, n);
                }
            }
            table = result;
        }
        this.jumpTables.set(from, table);
        return table;
    }

    private placeIndex() {
        if (!this.places) {
            const placeOf = new Map<string, string>();
            const systemsAt = new Map<string, string[]>();
            for (const id of this.systemIds) {
                const [x, y] = this.systemsById.get(id)!.position;
                const key = `${x},${y}`;
                placeOf.set(id, key);
                const at = systemsAt.get(key);
                if (at) {
                    at.push(id);
                } else {
                    systemsAt.set(key, [id]);
                }
            }
            this.places = { placeOf, systemsAt };
        }
        return this.places;
    }
}

const SPREAD_NUMERATOR = 13n;
const SPREAD_DENOMINATOR = 20n;

/**
 * A penalty field `field` scaled for a system `jumps` hyperlink jumps from
 * the crime: field x 0.65^jumps, truncated toward zero (reference "A14
 * spread, wave 14": the six-jump chain pins the factor to 0.6498-0.6501,
 * and the floor is per FIELD, before any halving). Exact integer
 * arithmetic (13^n / 20^n in BigInt), so no floating-point power can round
 * differently on two engines. A negative field truncates toward zero as C
 * integer arithmetic would (unmeasured: no negative field has spread).
 */
export function scaledPenalty(field: number, jumps: number): number {
    if (jumps <= 0 || field === 0) {
        return field;
    }
    const n = BigInt(jumps);
    return Number(BigInt(Math.trunc(field)) * SPREAD_NUMERATOR ** n
        / SPREAD_DENOMINATOR ** n);
}

/**
 * The penalty fields a crime charges, signed, as written (0 is no penalty:
 * reputation.ts's crimePenalty). A kill is Disab + Kill
 * (`['disable', 'kill']`), or Kill alone when the same player was already
 * charged the Disab for disabling it (reputation_plugin.ts).
 */
function crimeFields(govt: GovtData, crimes: readonly Crime[]): number[] {
    return crimes.map(crime => crimePenalty(govt, crime));
}

/**
 * The change one crime makes to the record of ONE system, `jumps` jumps
 * from where it happened, owned by `owner` (undefined: independent): the
 * rule in the module comment.
 *
 *  - victim === owner, or allied with it either way: minus the VICTIM's
 *    scaled fields (wave 12's -130 and -60, wave 14's -8002 / -5201);
 *  - no owner: minus a quarter of the VICTIM's scaled fields, each halved
 *    twice and truncated (wave 16's -76 / -49, wave 15's -20), and a crime
 *    IN an independent system charges that system the same way at 0
 *    jumps (MEASURED, "A14 wave 18": Disab 400 + Kill 2000 there gave
 *    -(100 + 500) = -600, its owned neighbours the own-victim rule at 1
 *    and 2 jumps, -1560 / -1014);
 *  - otherwise: plus half of the OWNER's scaled fields, each halved and
 *    truncated (+9, +65, +17, +11, +7, +48, +2600 ... +301, +32, +67).
 */
export function crimeRecordChange(victim: GovtData,
    owner: GovtData | undefined, crimes: readonly Crime[],
    jumps: number): number {
    if (!owner) {
        return -crimeFields(victim, crimes).reduce((sum, field) => sum
            + Math.trunc(Math.trunc(scaledPenalty(field, jumps) / 2) / 2), 0);
    }
    if (victim.id === owner.id || alliedEitherWay(victim, owner)) {
        return -crimeFields(victim, crimes).reduce(
            (sum, field) => sum + scaledPenalty(field, jumps), 0);
    }
    return crimeFields(owner, crimes).reduce(
        (sum, field) => sum + Math.trunc(scaledPenalty(field, jumps) / 2), 0);
}

/**
 * Applies a crime against a ship of `victim` committed in `systemId`: the
 * change to that system and to every system the spread reaches
 * (crimeRecordChange, by jumpsFrom). A change of 0 materializes nothing.
 */
export function applyCrime(records: LegalRecords, geography: LegalGeography,
    systemId: string, victim: GovtData, crimes: readonly Crime[]): void {
    for (const [target, jumps] of geography.jumpsFrom(systemId)) {
        const delta = crimeRecordChange(victim,
            geography.owner(target), crimes, jumps);
        if (delta !== 0) {
            geography.addRecord(records, target, delta);
        }
    }
}

/**
 * Adds a FIXED `delta` to the record in `systemId` and, scaled by 0.65 per
 * hyperlink jump and truncated (scaledPenalty), in every system the walk
 * reaches, whoever owns it: a tribute demand's -600 (reference "Tribute
 * (R18), wave 39", finding 7: "every demand that is not laughed at costs
 * -600 in the planet's system ... spread 0.65 per jump as usual"). GUESS:
 * the spread was read in a rig whose linked systems all had the stellar's
 * own owner, so the owner / ally / independent split of a crime
 * (crimeRecordChange) was not exercised; this applies the plain scaled
 * change everywhere. A delta that truncates to 0 materializes nothing.
 */
export function applyRecordSpread(records: LegalRecords,
    geography: LegalGeography, systemId: string, delta: number): void {
    for (const [target, jumps] of geography.jumpsFrom(systemId)) {
        const change = scaledPenalty(delta, jumps);
        if (change !== 0) {
            geography.addRecord(records, target, change);
        }
    }
}

/**
 * Adds `delta` to the record in every system `govtId` owns: a mission's
 * failure / 0x0040 abort with its CompGovt (reference "A14 spread, wave
 * 14", finding 6: -500 in every system of gövt 338 and nowhere else).
 * Independent systems are owned by no one, gövt 128 included.
 */
export function applyGovtRecordChange(records: LegalRecords,
    geography: LegalGeography, govtId: string, delta: number): void {
    if (delta === 0) {
        return;
    }
    for (const systemId of geography.systemIds) {
        if (geography.system(systemId)!.govt === govtId) {
            geography.addRecord(records, systemId, delta);
        }
    }
}

/**
 * Applies a COMPLETED mission's CompReward R, which on the original is
 * govt-wide, not by jumps (reference "A14 spread, wave 14", finding 5):
 * +R in every system the CompGovt owns; +trunc(R / 2) in every system of a
 * govt allied to it (govtRelation, either direction); -trunc(R / 2) in
 * every system of its enemies and of every xenophobic (gövt Flags 0x0001)
 * govt that is not its ally. Independent systems do not change (Kit Range,
 * where the run completed, did not).
 *
 * Without `compGovt` data (a number no loaded set defines) only the
 * systems owned by that id change, as before.
 */
export function applyCompletionReward(records: LegalRecords,
    geography: LegalGeography, compGovtId: string,
    compGovt: GovtData | undefined, reward: number): void {
    const half = Math.trunc(reward / 2);
    for (const systemId of geography.systemIds) {
        const ownerId = geography.system(systemId)!.govt;
        if (!ownerId) {
            continue;
        }
        if (ownerId === compGovtId || ownerId === compGovt?.id) {
            geography.addRecord(records, systemId, reward);
            continue;
        }
        const owner = geography.govt(ownerId);
        if (!compGovt || !owner || half === 0) {
            continue;
        }
        const relation = govtRelation(compGovt, owner);
        if (relation === 'ally') {
            geography.addRecord(records, systemId, half);
        } else if (relation === 'enemy' || owner.flags.xenophobic) {
            geography.addRecord(records, systemId, -half);
        }
    }
}

function intersects(a: readonly number[], b: readonly number[]): boolean {
    return a.some(x => b.includes(x));
}

/**
 * Cleans (raises to 0) every negative record in the systems of one govt,
 * and per `scope` also of its allies or classmates: the mïsn PayVal
 * -10xxx / -20xxx / -30xxx encodings and oütf ModType 21. Never lowers a
 * good record. Scope 'all' (ModType 21 ModVal -1) cleans every system,
 * independent ones included, and any stored entry for a system this
 * geography does not know.
 *
 * Per system because the record is (the Bible's "clean legal record with
 * the govt" reads, on per-system records, as the systems that govt owns);
 * independent systems belong to no govt, gövt 128 included.
 */
export function cleanRecords(records: LegalRecords,
    geography: LegalGeography,
    scope: 'govt' | 'allies' | 'classmates' | 'all',
    govtData: GovtData | undefined): void {
    const clean = (systemId: string) => {
        if (geography.recordIn(records, systemId) < 0) {
            records.set(systemId, 0);
        }
    };
    if (scope === 'all') {
        for (const systemId of geography.systemIds) {
            clean(systemId);
        }
        for (const [systemId, record] of [...records]) {
            if (record < 0) {
                records.set(systemId, 0);
            }
        }
        return;
    }
    if (!govtData) {
        return;
    }
    const covered = (owner: GovtData) => owner.id === govtData.id
        || (scope === 'allies'
            // The named govt's allies: govts whose classes intersect its
            // ally class numbers.
            ? intersects(govtData.allies, owner.classes)
            : scope === 'classmates'
                && intersects(govtData.classes, owner.classes));
    for (const systemId of geography.systemIds) {
        const owner = geography.owner(systemId);
        if (owner && covered(owner)) {
            clean(systemId);
        }
    }
}

/**
 * Builds a fresh pilot's records from chär Govt1-4 / Status1-4 (Bible:
 * "the player's legal status in systems owned by that government or one of
 * its allies is set to the value in the corresponding Status field. For
 * systems owned by an enemy of the govt ... the negative value"). In
 * order, a later status overriding an earlier one in a system both reach.
 * Ally / enemy is govtRelation's (either direction), as before.
 */
export function initialRecordsFromGovtStatuses(
    statuses: readonly { govt: string, status: number }[],
    geography: LegalGeography): LegalRecords {
    const records: LegalRecords = new Map();
    for (const { govt: govtId, status } of statuses) {
        const named = geography.govt(govtId);
        for (const systemId of geography.systemIds) {
            const ownerId = geography.system(systemId)!.govt;
            if (!ownerId) {
                continue;
            }
            if (ownerId === govtId) {
                records.set(systemId, status);
                continue;
            }
            const owner = geography.govt(ownerId);
            if (!named || !owner) {
                continue;
            }
            const relation = govtRelation(named, owner);
            if (relation === 'ally') {
                records.set(systemId, status);
            } else if (relation === 'enemy') {
                records.set(systemId, -status);
            }
        }
    }
    for (const [systemId, record] of records) {
        records.set(systemId, clampRecord(record));
    }
    return records;
}

/**
 * Seeds per-system records from an older save's PER-GOVT ones (save v5 and
 * before, ruling #376's model): each system takes its status govt's old
 * record, when the old save held one. Systems whose status govt had no
 * entry stay absent (they read InitialRec, as they did).
 */
export function systemRecordsFromGovtRecords(
    govtRecords: Iterable<readonly [string, number]>,
    geography: LegalGeography): LegalRecords {
    const byGovt = new Map(govtRecords);
    const records: LegalRecords = new Map();
    for (const systemId of geography.systemIds) {
        const old = byGovt.get(geography.statusGovtId(systemId));
        if (old !== undefined) {
            records.set(systemId, old);
        }
    }
    return records;
}
