import { GovtData } from 'novadatainterface/govt_data';
import { PlanetData } from 'novadatainterface/planet_data';
import { isInhabited, landable } from '../core/index.js';
import type { MissionContext } from './mission_context.js';
import { resolveNumberedResource, sameNumberedResource } from './mission_ids.js';
import { evaluateNCBTest } from '../ncb/index.js';
import { LegalRecords, recordWith } from '../reputation/index.js';

/**
 * Stellar matching for missions: the flattened StellarInfo, sÿst
 * Visibility, the AvailStel / TravelStel / ReturnStel reference encoding
 * (matchesStellarRef) and the player's legal record at a stellar. Split
 * out of mission_logic.ts.
 */

/** What availability matching needs to know about a stellar. */
export interface StellarInfo {
    id: string;
    /** Global gövt id or null for independent. */
    govt: string | null;
    uninhabited: boolean;
    canLand: boolean;
    /**
     * The sÿst Visibility NCB test expressions of every system that
     * contains this stellar (blank = always visible). Absent when the
     * caller has no system topology (bare test stellars, the landed
     * stellar); such stellars are treated as visible. See stellarVisible.
     */
    systemVisibilities?: string[];
}

export function stellarInfoOf(planet: PlanetData): StellarInfo {
    return {
        id: planet.id,
        govt: planet.govt,
        uninhabited: planet.flags.uninhabited,
        // The one shared port predicate (landable.ts), so a mission can
        // never send the player somewhere the land gate refuses.
        canLand: landable(planet),
    };
}

/**
 * Whether a candidate stellar sits in a currently-visible system, per the
 * sÿst Visibility field (EVN Bible, "The Visibility field controls how and
 * when to make the system visible or invisible... an NCB control bit test
 * expression - leave it blank if unused"). Duplicate stellars stacked at
 * one map position use mutually-exclusive Visibility expressions, so only
 * one copy is real at a time; a stellar is visible if ANY of its containing
 * systems is visible. Absent visibility info (bare test stellars) is
 * treated as visible (fail open, so a malformed expression can't empty the
 * candidate pool). Keeps currently-hidden duplicate stellars — e.g. the
 * Federation-govt copy of a Polaris system, or an alternate story-state
 * copy of a planet — out of random/ranged mission-destination sampling.
 */
export function stellarVisible(stellar: StellarInfo,
    bits: Set<number>): boolean {
    const exprs = stellar.systemVisibilities;
    if (!exprs || exprs.length === 0) {
        return true;
    }
    return exprs.some(expr => {
        if (!expr || expr.trim() === '') {
            return true;
        }
        try {
            return evaluateNCBTest(expr, { getBit: bit => bits.has(bit) });
        } catch {
            // A malformed Visibility expression must not hide the galaxy.
            return true;
        }
    });
}

function intersects(a: number[], b: number[]): boolean {
    return a.some(x => b.includes(x));
}

/**
 * Resolves whether a stellar sits in a target system or one adjacent to
 * it, for the AvailStel 5000-7047 range. Supplied by callers that have
 * system topology (the mission board / landing); callers without it
 * (e.g. the travel/return resolution, where the Bible does not define
 * 5000-7047) omit it and the range never matches.
 */
export interface StellarAdjacency {
    /** The global system id containing `stellarId`, or undefined. */
    systemOfStellar(stellarId: string): string | undefined;
    /** Whether system `a` is the same as or hyperlinked to system `b`. */
    systemsAdjacentOrEqual(a: string, b: string): boolean;
}

/**
 * Whether `stellar` matches a mïsn stellar reference (the AvailStel /
 * TravelStel / ReturnStel encoding). `refId` is the parse-time
 * resolved global id for plain ids. The adjacent-system range
 * (5000-7047, AvailStel only per the Bible) is matched only when the
 * caller supplies `adjacency`; otherwise it never matches.
 */
export function matchesStellarRef(ref: number, refId: string | null,
    stellar: StellarInfo, missionPrefix: string,
    getGovt: (id: string) => GovtData | undefined,
    adjacency?: StellarAdjacency,
    systemExists?: (globalId: string) => boolean): boolean {
    if (ref === -1) {
        // "Any inhabited stellar" — the spöb 0x0020 bit alone (landable.ts
        // isInhabited). Landability is not part of it: the candidate here is
        // the stellar the player is standing on, which is landable by
        // construction.
        return isInhabited(stellar);
    }
    if (refId !== null) {
        return stellar.id === refId;
    }
    // AvailStel 5000-7047: "Stellar in a system adjacent to specific
    // system" (the range indexes system ids 128-2175 by 5000 + (id -
    // 128)). Matches the target system itself as well as its neighbors.
    if (ref >= 5000 && ref <= 7047) {
        if (!adjacency) {
            return false;
        }
        // The sÿst number resolves stock-first like every other numeric
        // reference (resolveNumberedResource, via `systemExists`): a
        // plug-in mission's 5000+n naming a STOCK system means nova:n,
        // not a phantom id under the plug-in's own prefix.
        const targetSystem = resolveNumberedResource(
            ref - 5000 + 128, missionPrefix, systemExists);
        const stellarSystem = adjacency.systemOfStellar(stellar.id);
        return stellarSystem !== undefined
            && adjacency.systemsAdjacentOrEqual(stellarSystem, targetSystem);
    }
    if (ref === 9999) {
        return stellar.govt === null;
    }
    const stellarGovt = stellar.govt ? getGovt(stellar.govt) : undefined;

    /** The govt the range is relative to. */
    function rangeGovt(base: number): GovtData | undefined {
        // A plug-in's own new govt lives under its prefix; a stock (or
        // stock-overridden) one under nova:.
        return getGovt(`${missionPrefix}:${ref - base + 128}`)
            ?? getGovt(`nova:${ref - base + 128}`);
    }
    function isGovt(base: number): boolean {
        return sameNumberedResource(stellar.govt, ref - base + 128,
            missionPrefix);
    }
    function classmate(x: GovtData | undefined): boolean {
        if (!x || !stellarGovt) {
            return false;
        }
        return intersects(x.classes, stellarGovt.classes);
    }

    if (ref >= 10000 && ref <= 10255) {
        return isGovt(10000);
    }
    if (ref >= 15000 && ref <= 15255) {
        // The govt's stellar or an ally's.
        const x = rangeGovt(15000);
        return isGovt(15000) || Boolean(x && stellarGovt
            && intersects(x.allies, stellarGovt.classes));
    }
    if (ref >= 20000 && ref <= 20255) {
        return !isGovt(20000);
    }
    if (ref >= 25000 && ref <= 25255) {
        const x = rangeGovt(25000);
        return Boolean(x && stellarGovt
            && intersects(x.enemies, stellarGovt.classes));
    }
    if (ref >= 30000 && ref <= 30255) {
        return isGovt(30000) || classmate(rangeGovt(30000));
    }
    if (ref >= 31000 && ref <= 31255) {
        return !(isGovt(31000) || classmate(rangeGovt(31000)));
    }
    return false;
}

/**
 * Builds the StellarAdjacency for AvailStel 5000-7047 from a mission
 * context's system topology. Returns undefined when the caller didn't
 * supply systems (the range then never matches — fail closed).
 */
export function stellarAdjacencyOf(ctx: MissionContext):
    StellarAdjacency | undefined {
    const { systems, systemIdOfStellar } = ctx;
    if (!systems || !systemIdOfStellar) {
        return undefined;
    }
    const linksById = new Map(systems.map(s => [s.id, s.links]));
    return {
        systemOfStellar: id => systemIdOfStellar(id),
        systemsAdjacentOrEqual: (a, b) =>
            a === b || (linksById.get(a)?.includes(b) ?? false),
    };
}

/**
 * The player's legal record at a stellar: the record with its govt,
 * or — for an independent stellar — with govt 128, the Bible's rule
 * for independent systems (Appendix II).
 */
export function stellarRecord(stellar: StellarInfo, records: LegalRecords,
    missionPrefix: string,
    getGovt: (id: string) => GovtData | undefined): number {
    // The Bible's "first government [ID 128]" is a bare number, so it
    // resolves stock-first like every other one: `nova:128` whenever
    // stock defines it (it always does), and only a plug-in's own 128
    // when a total conversion has replaced the stock govts. Keyed on
    // the writer alone, a plug-in mission at an independent stellar was
    // judged against a phantom `<plug>:128` record that no crime ever
    // writes and no govt backs (#107).
    const govtId = stellar.govt ?? resolveNumberedResource(128,
        missionPrefix, id => getGovt(id) !== undefined);
    return recordWith(records, govtId, getGovt(govtId));
}
