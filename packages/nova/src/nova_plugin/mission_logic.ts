import { GovtData } from 'novadatainterface/govt_data';
import { RankData } from 'novadatainterface/rank_data';
import { MissionData } from 'novadatainterface/mission_data';
import { PlanetData } from 'novadatainterface/planet_data';
import { DEFAULT_CARGO_NAMES } from 'novadatainterface/player_start_data';
import { evaluateNCBTest, makeControlBitHooks, NCBParseError, NCBSetHooks, runNCBSet } from './ncb.js';
import { Cargo, cargoUsed } from './cargo_plugin.js';
import {
    DiscoveryAccess, discoveryNCBOperators, DiscoveryNCBOperators,
} from './discovery.js';
import { isInhabited, isPort, landable } from './landable.js';
import { resolveShipObjective, shipGoalOfferable } from './mission_ship_logic.js';
import type { SystemInfo } from './mission_ship_logic.js';
import {
    GOAL_BOARD, GOAL_RESCUE, objectiveAllowsCompletion, ShipObjective,
} from './mission_ship_state.js';
import { ActiveRanks } from './ncb_plugin.js';
import {
    ActiveMission, MAX_ACTIVE_MISSIONS, Missions, PendingAutoAbortShip,
} from './player_state_plugin.js';
import {
    addRecord,
    AVAIL_RECORD_DOMINATED_ANY,
    AVAIL_RECORD_DOMINATED_HERE,
    availRatingOk,
    availRecordOk,
    cleanRecords,
    compRewardDelta,
    decodePayVal,
    LegalRecords,
    PayValEffect,
    recordWith,
} from './reputation.js';

/**
 * Pure mission mechanics: availability evaluation, offer resolution
 * (random destinations and cargo quantities are frozen at offer time,
 * as in EV Nova), acceptance, and landing processing (travel legs,
 * completion, deadlines, aborts).
 *
 * Everything here is player-local: it runs while the player's entity
 * is out of the simulation (docked, or in the hands of the jump
 * handoff), so the `random` source may be plain randomness — only the
 * resulting component state reaches the simulation. See
 * mission_board.ts and browser.ts for the wiring.
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

/** The numeric resource id of a global id like "nova:130", or null. */
export function numericId(globalId: string | null): number | null {
    if (!globalId) {
        return null;
    }
    const n = parseInt(globalId.split(':').pop() ?? '', 10);
    return Number.isNaN(n) ? null : n;
}

/** The prefix of a global id like "nova:130" ("nova"). */
export function idPrefix(globalId: string): string {
    const colon = globalId.lastIndexOf(':');
    return colon === -1 ? 'nova' : globalId.slice(0, colon);
}

/**
 * THE ONE RULE for which namespace a bare resource NUMBER written inside a
 * resource's own data — set strings, availability expressions, AvailStel /
 * CompGovt-style numeric fields — is scoped to: the plug-in that WROTE the
 * resource (BaseData.writerPrefix), which is NOT the prefix of its id
 * whenever the plug-in overrides a stock resource, because the override
 * keeps the stock id. Every site that resolves such a number keys it on
 * this prefix and resolves it stock-first through
 * {@link resolveNumberedResource} (or its exists-requiring twin
 * {@link resolveExistingNumberedResource}).
 *
 * Falls back to the id's own prefix for hand-made data that never set a
 * writer — getDefaultBaseData()'s "default" placeholder included, which is
 * what every test fixture that spreads the defaults carries.
 */
export function setStringPrefix(
    resource: { id: string, writerPrefix?: string }): string {
    const writer = resource.writerPrefix;
    return writer && writer !== 'default' ? writer : idPrefix(resource.id);
}

export interface MissionContext {
    /** The stellar the player is landed on. */
    stellar: StellarInfo;
    /** All landable stellars, for resolving random/ranged destinations. */
    stellarCandidates: StellarInfo[];
    /** The player's REAL control bits. */
    bits: Set<number>;
    /** Global id of the player's ship type. */
    shipId: string;
    /**
     * Global gövt id of the player's ship's inherent government, or
     * null/undefined when it has none (or the ship data isn't loaded).
     * Gates the AvailShipType ship-govt ranges (2128+/3128+).
     */
    shipGovt?: string | null;
    /**
     * The player's ship class's shïp InherentAI (1 wimpy trader, 2 brave
     * trader, 3 warship, 4 interceptor), gating mïsn Flags 0x2000 /
     * 0x4000. Absent (ship data not loaded) leaves both gates open,
     * like `shipGovt`.
     */
    shipInherentAI?: number;
    /** Missions already active (missions can't be offered twice). */
    activeMissions: Missions;
    /** Free cargo space in tons (capacity minus cargo aboard). */
    freeCargoSpace: number;
    /** The player's legal records (AvailRecord); absent = no records. */
    records?: LegalRecords;
    /** The player's combat-rating kill points (AvailRating). */
    combatRating?: number;
    /**
     * The player's combined 64-bit Contribute mask (ship + outfits),
     * checked against the mïsn Require field. Absent = 0n (only a
     * zero Require passes).
     */
    playerContribute?: bigint;
    /** Uniform [0, 1). Player-local; plain randomness is fine. */
    random(): number;
    /** Synchronous cached govt lookup (warm the cache first). */
    getGovt(id: string): GovtData | undefined;
    /** Current absolute day number (calendar.ts dayNumber). */
    currentDay: number;
    /**
     * All systems, for resolving special/aux ship spawn systems
     * (mission_ship_logic.ts). Optional: callers that don't supply it
     * keep ship-goal missions unofferable (fail closed).
     */
    systems?: SystemInfo[];
    /** Maps a planet id to its containing system id. */
    systemIdOfStellar?(planetId: string): string | undefined;
    /**
     * `Exxx` in AvailBits: the player's per-system discovery record
     * (discovery.ts). Optional — absent leaves every `Exxx` false, which is
     * how the term behaved before this was threaded through.
     */
    discovery?: DiscoveryAccess;
    /**
     * Whether a sÿst with this global id exists, so `Exxx`'s bare number
     * resolves stock-first like every other numeric reference. Without it a
     * plug-in's number always means that plug-in's own system.
     */
    systemExists?(globalId: string): boolean;
    /**
     * `Oxxx` in AvailBits: the player's owned outfits (global id -> count),
     * the same map the set-string `Gxxx`/`Dxxx` operators work on. Optional
     * — absent leaves every `Oxxx` false, which is what the term evaluated
     * to before this was threaded through (and what left mïsn nova:649
     * "Renew darts", `b371 & !O226`, firing on EVERY landing: `!O226` was
     * always true, so a Vell-os pilot holding darts was handed three more
     * each time). MissionSession supplies its working copy.
     */
    ownedOutfits?: ReadonlyMap<string, number>;
    /**
     * The player's current fuel, for mïsn Flags 0x0008's offer gate:
     * "Mission takes away 100 units of fuel upon auto-abort. (mission won't
     * be offered if player has less than 100 units of fuel)". Optional —
     * a caller with no fuel reading (the bare test contexts) leaves the gate
     * open, the pre-existing behaviour, rather than silencing every Refuel
     * Trader for want of a number.
     */
    fuel?: number;
}

/**
 * Whether the player owns at least one of the outfit a resource written by
 * plug-in `prefix` means by the bare number `id` — the `Oxxx` operator's
 * question, shared by a mïsn's AvailBits (testBits) and a crön's EnableOn
 * (cron_logic.ts). Resolved through {@link sameNumberedResource}: stock's
 * outfit n, or the writer's own — never a third plug-in's n.
 */
export function ownsOutfit(owned: ReadonlyMap<string, number> | undefined,
    id: number, prefix: string): boolean {
    if (!owned) {
        return false;
    }
    for (const [globalId, count] of owned) {
        if (count > 0 && sameNumberedResource(globalId, id, prefix)) {
            return true;
        }
    }
    return false;
}

function intersects(a: number[], b: number[]): boolean {
    return a.some(x => b.includes(x));
}

/**
 * Whether the player's Contribute mask covers a mïsn/oütf Require field
 * (a decimal or hex 64-bit string). Every 1-bit in Require must be set
 * in `contribute`. A '0' (or malformed) require is always satisfied.
 */
function requireMet(require: string, contribute: bigint): boolean {
    let mask: bigint;
    try {
        mask = BigInt(require);
    } catch {
        return true;
    }
    return (mask & contribute) === mask;
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
 * Safe NCB test evaluation for a mïsn's AvailBits: malformed expressions
 * fail closed.
 *
 * `Exxx` sees the player's discovery record when the caller supplied one,
 * and `Oxxx` the player's outfits (ctx.ownedOutfits), with the mission's
 * own plug-in prefix scoping the sÿst / oütf number — the same rule every
 * other numeric reference in a mission follows.
 */
function testBits(expression: string, ctx: MissionContext,
    missionPrefix: string): boolean {
    const bits = ctx.bits;
    const discovery = systemDiscoveryOperators(
        ctx.discovery, missionPrefix, ctx.systemExists);
    const owned = ctx.ownedOutfits;
    try {
        return evaluateNCBTest(expression, {
            getBit: bit => bits.has(bit),
            ...(discovery ? { hasExplored: discovery.hasExplored } : {}),
            ...(owned
                ? { hasOutfit: (id: number) => ownsOutfit(owned, id, missionPrefix) }
                : {}),
        });
    } catch (e) {
        if (e instanceof NCBParseError) {
            console.warn('Bad mission NCB test:', e.message);
            return false;
        }
        throw e;
    }
}

/**
 * A concrete offer: the mission with its random choices (destination,
 * cargo) already frozen, ready to show and accept.
 */
export interface MissionOffer {
    data: MissionData;
    travelPlanet: string | null;
    returnPlanet: string | null;
    /** Resolved cargo type (0-255) or -1. */
    cargoType: number;
    cargoQty: number;
    /** Frozen special-ship objective; absent without special ships. */
    shipObjective?: ShipObjective;
    /** Whether Accept may be clicked (cargo fits, mission cap). */
    acceptable: boolean;
    /** Why not, when !acceptable. */
    reason?: string;
}

/**
 * AvailLoc values — where on a stellar a mission is offered (EVN Bible,
 * "AvailLoc"): 0 mission computer, 1 bar, 2 offered from a ship (përs),
 * 3 the main spaceport dialog (offered on landing), 4 trading, 5
 * shipyard, 6 outfitter. See mission_data.ts.
 */
export const LOCATION_MISSION_COMPUTER = 0;
export const LOCATION_BAR = 1;
export const LOCATION_SHIP = 2;
export const LOCATION_MAIN_SPACEPORT = 3;
export const LOCATION_TRADING = 4;
export const LOCATION_SHIPYARD = 5;
export const LOCATION_OUTFIT = 6;

/**
 * Whether the mission should appear at this stellar/location for this
 * player, not counting the AvailRandom roll — that is rolled once per
 * SYSTEM VISIT by the caller (spaceport/mission_offers.ts OfferRolls, per
 * the Bible's "recalculated each time you warp into a system"), so
 * neither a second landing nor re-opening the board rerolls it.
 *
 * Known simplifications (documented gaps): Require must be zero (no
 * Contribute bits), and missions with a RESCUE ship goal are never
 * offered — that goal needs "spawn disabled and stay disabled", which
 * does not exist (see mission_ship_state.ts's goalSupported). BOARD-goal
 * missions ARE offered now that boarding is real.
 */
export function missionMatchesLocation(mission: MissionData,
    location: number, ctx: MissionContext): boolean {
    if (mission.availLoc !== location) {
        return false;
    }
    if (ctx.activeMissions.has(mission.id)) {
        return false;
    }
    // AvailStel is "Which stellar objects (i.e. planets) the mission is
    // available at" (EVN Bible) — a question with no answer for a
    // mission offered BY A SHIP, which happens in open space at no
    // stellar at all. The in-flight offer context borrows a stellar from
    // the player's system so ShipSyst -1 and `acceptedAt` have something
    // to resolve through (ship_mission_accept's inFlightStellar), and
    // judging AvailStel against that borrowed rock would be an accident:
    // a system whose only spöbs are gas giants would silence every
    // AvailStel -1 ("any inhabited stellar") mission in it, the Refuel
    // Traders included. All 13 stock AvailLoc 2 missions are AvailStel
    // -1, so nothing is lost by not asking.
    // Numeric references in the mïsn's own fields are scoped to the
    // plug-in that WROTE it (setStringPrefix), not to its id's prefix.
    const prefix = setStringPrefix(mission);
    if (location !== LOCATION_SHIP
        && !matchesStellarRef(mission.availStel, mission.availStelId,
            ctx.stellar, prefix, ctx.getGovt,
            stellarAdjacencyOf(ctx), ctx.systemExists)) {
        return false;
    }
    // Domination is not implemented; missions gated on it never show.
    if (mission.availRecord === AVAIL_RECORD_DOMINATED_HERE
        || mission.availRecord === AVAIL_RECORD_DOMINATED_ANY) {
        return false;
    }
    // AvailRecord: the record with this stellar's govt (independent
    // stellars judge by govt 128, per the Bible's Appendix II rule for
    // independent systems).
    if (!availRecordOk(mission.availRecord,
        stellarRecord(ctx.stellar, ctx.records ?? new Map(),
            prefix, ctx.getGovt))) {
        return false;
    }
    if (!availRatingOk(mission.availRating, ctx.combatRating ?? 0)) {
        return false;
    }
    // Require: every 1-bit must be covered by the player's Contribute
    // mask (ship + outfits). Absent contribute means only require '0'
    // (no requirement) passes.
    if (!requireMet(mission.require, ctx.playerContribute ?? 0n)) {
        return false;
    }
    // Board/rescue ship goals need boarding, which is unimplemented;
    // offering such a mission would make it impossible to complete.
    if (!shipGoalOfferable(mission)) {
        return false;
    }
    if (!shipTypeMatches(mission.availShipType, ctx.shipId, ctx.shipGovt,
        prefix)) {
        return false;
    }
    if (!shipAIMatches(mission, ctx.shipInherentAI)) {
        return false;
    }
    // mïsn Flags 0x0008 (EVN Bible): "Mission takes away 100 units of fuel
    // upon auto-abort. (mission won't be offered if player has less than
    // 100 units of fuel)". The parenthetical is the offer gate, applied
    // wherever the flag is set. Stock: the Refuel Traders (nova:141,
    // 650-652) — without it a pilot on 30 units could hand over "100
    // units", collect the 2000 credits and lose only the 30. A context
    // with no fuel reading leaves the gate open (see MissionContext.fuel).
    if (mission.flags.remove100FuelOnAutoAbort && ctx.fuel !== undefined
        && ctx.fuel < AUTO_ABORT_FUEL_COST) {
        return false;
    }
    if (!testBits(mission.availBits, ctx, prefix)) {
        return false;
    }
    return true;
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

/**
 * Whether the player's ship satisfies a mïsn AvailShipType. The Bible's
 * ranges: 0/-1 ignored; 128-895 must be this ship type; 1128-1895 must
 * not be; 2128-2383 must be a ship of this inherent gövt; 3128-3383
 * must not be. `shipGovt` is the global id of the player's ship's
 * inherent gövt (null when it has none).
 */
function shipTypeMatches(availShipType: number, shipId: string,
    shipGovt: string | null | undefined, missionPrefix: string): boolean {
    if (availShipType <= 0) {
        return true;
    }
    if (availShipType >= 128 && availShipType <= 895) {
        return sameNumberedResource(shipId, availShipType, missionPrefix);
    }
    if (availShipType >= 1128 && availShipType <= 1895) {
        return !sameNumberedResource(shipId, availShipType - 1000,
            missionPrefix);
    }
    // Ship-govt ranges: the govt id is the range offset (2000 / 3000).
    if (availShipType >= 2128 && availShipType <= 2383) {
        return sameNumberedResource(shipGovt ?? null,
            availShipType - 2000, missionPrefix);
    }
    if (availShipType >= 3128 && availShipType <= 3383) {
        return !sameNumberedResource(shipGovt ?? null,
            availShipType - 3000, missionPrefix);
    }
    return true;
}

/**
 * mïsn Flags 0x2000 "Mission unavailable if player's ship is of
 * inherentAI type 1 or 2 (cargo ships)" and 0x4000 "... of inherentAI
 * type 3 or 4 (warships)" (EVN Bible). Stock uses 0x2000 alone — the
 * six house duels nova:759-764 and nova:597 "Test RAGE Gunboat", none of
 * which a freighter should be handed; 0x4000 has no stock user. An
 * unknown InherentAI (ship data not loaded) passes both, as an unknown
 * ship govt passes the AvailShipType ranges.
 */
function shipAIMatches(mission: MissionData,
    inherentAI: number | undefined): boolean {
    if (inherentAI === undefined) {
        return true;
    }
    if (mission.flags.notForCargoShips
        && (inherentAI === 1 || inherentAI === 2)) {
        return false;
    }
    if (mission.flags.notForWarships
        && (inherentAI === 3 || inherentAI === 4)) {
        return false;
    }
    return true;
}

/**
 * Whether the resource with global id `globalId` is the one a mission
 * from `missionPrefix` means by the bare number `n`. Under the id-space
 * rules a plug-in's number resolves to the STOCK resource (`nova:n`) when
 * stock has one — including plug-in overrides of it — and to the plug-in's
 * OWN (`<prefix>:n`) otherwise; two plug-ins that each add a new resource
 * n get separate ids. So the number must match AND the prefix must be
 * either nova or the mission's own — never a third plug-in's. Comparing
 * numbers alone made ARPIA's "any stellar of govt 196" (arpia:196) match
 * Planet Rico's Gravit Station (govt "Planet Rico:196").
 */
export function sameNumberedResource(globalId: string | null | undefined,
    n: number, missionPrefix: string): boolean {
    if (!globalId) {
        return false;
    }
    if (numericId(globalId) !== n) {
        return false;
    }
    const prefix = idPrefix(globalId);
    return prefix === 'nova' || prefix === missionPrefix;
}

/**
 * The WRITE-side twin of {@link sameNumberedResource}: which single global
 * id a resource from `prefix` means by the bare number `n`. Same id-space
 * rule, applied in the one direction a set string needs it — `Gxxx` has to
 * name exactly one outfit to grant.
 *
 * `existingId` reports whether a global id exists in the relevant id space
 * (the outfits, for Gxxx/Dxxx). Stock wins when it has an `n`, including a
 * plug-in's override of a stock resource, which keeps its "nova:" id;
 * otherwise the resource means its own plug-in's `n`. Extra Outfits' crön
 * 500 `G135 G135 G135` is the stock IR Missile (nova:135), while its crön
 * 504 `G464 G464 G464` is the plug-in's own Siege Mine — the same number
 * range, told apart only by what stock happens to define.
 *
 * With no id space to consult the plug-in's own is assumed, which is the
 * behaviour every call site had before this existed.
 */
export function resolveNumberedResource(n: number, prefix: string,
    existingId?: (globalId: string) => boolean): string {
    if (existingId?.(`nova:${n}`)) {
        return `nova:${n}`;
    }
    return `${prefix}:${n}`;
}

/**
 * {@link resolveNumberedResource} for references that must name a resource
 * that actually EXISTS: undefined when neither stock nor `prefix`'s own
 * data defines `n`.
 *
 * The `Exxx` / `Xxxx` system operators need this because their id space is
 * sparse where the outfit one is dense. `Gxxx` naming a missing outfit
 * grants a count of an id nothing can look up, which the shops simply skip;
 * `Xxxx` naming a missing sÿst would write a phantom system id into the
 * pilot's PERSISTED discovery record, where it would sit forever. Same
 * stock-first rule, one extra question.
 *
 * Without an id space to consult the plug-in's own is assumed, exactly as
 * its twin does — a caller that cannot answer "does this exist" gets the
 * pre-existing behaviour rather than silently dropping every reference.
 */
export function resolveExistingNumberedResource(n: number, prefix: string,
    existingId?: (globalId: string) => boolean): string | undefined {
    if (!existingId) {
        return `${prefix}:${n}`;
    }
    if (existingId(`nova:${n}`)) {
        return `nova:${n}`;
    }
    return existingId(`${prefix}:${n}`) ? `${prefix}:${n}` : undefined;
}

/**
 * The `Exxx` / `Xxxx` operators for an expression written by plug-in
 * `prefix`, or undefined when the caller has no discovery record to offer
 * (the operators then fall back to their unimplemented defaults: `Exxx`
 * false, `Xxxx` ignored with a warning).
 *
 * Rebuilt per resource, like every other numeric-id wiring here, because
 * the sÿst number in `X130` means whatever the plug-in that WROTE that
 * expression means by 130.
 */
export function systemDiscoveryOperators(
    discovery: DiscoveryAccess | undefined, prefix: string,
    systemExists?: (globalId: string) => boolean):
    DiscoveryNCBOperators | undefined {
    if (!discovery) {
        return undefined;
    }
    return discoveryNCBOperators(discovery, id =>
        resolveExistingNumberedResource(id, prefix, systemExists));
}

/**
 * Resolves a travel/return stellar reference to a concrete planet id.
 * Returns undefined when the reference cannot be satisfied (which
 * makes the mission unofferable), null for "no destination".
 */
function resolveStellarRef(ref: number, refId: string | null,
    mission: MissionData, ctx: MissionContext,
    forReturn: boolean): string | null | undefined {
    if (ref === -1) {
        return null;
    }
    if (refId !== null) {
        return refId;
    }
    if (forReturn && ref === -4) {
        return ctx.stellar.id;
    }
    // Random / govt-ranged destinations sample only currently-VISIBLE
    // stellars: a hidden duplicate (e.g. an alternate-story-state copy of
    // a planet, stacked at the same coordinates under a mutually-exclusive
    // Visibility bit) must never be frozen as a destination — the player
    // would land on the visible copy under a different id and the mission
    // could never complete. Specific-id destinations (refId !== null) are
    // authored deliberately and are left unfiltered.
    let candidates: StellarInfo[];
    if (ref === -2) {
        candidates = ctx.stellarCandidates.filter(
            s => isPort(s) && stellarVisible(s, ctx.bits));
    } else if (ref === -3) {
        candidates = ctx.stellarCandidates.filter(
            s => !isInhabited(s) && s.canLand && stellarVisible(s, ctx.bits));
    } else {
        candidates = ctx.stellarCandidates.filter(s => s.canLand
            && stellarVisible(s, ctx.bits)
            && matchesStellarRef(ref, null, s, setStringPrefix(mission),
                ctx.getGovt));
    }
    // Don't send the player to the planet they're standing on.
    const elsewhere = candidates.filter(s => s.id !== ctx.stellar.id);
    if (elsewhere.length > 0) {
        candidates = elsewhere;
    }
    if (candidates.length === 0) {
        return undefined;
    }
    return candidates[Math.floor(ctx.random() * candidates.length)].id;
}

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

/**
 * mïsn Flags 0x0008: "Mission takes away 100 units of fuel upon
 * auto-abort. (mission won't be offered if player has less than 100 units
 * of fuel)". The figure is the Bible's, not a tunable.
 */
export const AUTO_ABORT_FUEL_COST = 100;

/** The CargoComponent key that holds a mission's cargo. */
export function missionCargoKey(missionId: string): string {
    return `mission:${missionId}`;
}

/**
 * A system to mark on the starmap for an active mission.
 *  - 'destination': a travel or return stellar's system (the original's
 *    red destination arrows), suppressed by the mïsn hideDestArrows flag.
 *  - 'shipSyst': the special-ship spawn system, marked only when the
 *    mïsn showArrowForShipSyst flag is set (the additional arrow).
 */
export interface MissionMapMark {
    systemId: string;
    kind: 'destination' | 'shipSyst';
    missionId: string;
}

/**
 * The systems to mark on the starmap for the player's active missions,
 * per the mïsn map flags. Pure: `systemOfStellar` maps a planet id to
 * its system id (undefined = unplaced), `getMission` fetches the static
 * mission data (undefined = not loaded). Destination marks come from the
 * travel/return stellars unless hideDestArrows is set; a ship-goal
 * system is marked only under showArrowForShipSyst. Deduplicated per
 * (system, kind, mission).
 */
export function missionMapMarks(missions: Iterable<ActiveMission>,
    getMission: (id: string) => MissionData | undefined,
    systemOfStellar: (planetId: string) => string | undefined):
    MissionMapMark[] {
    const marks: MissionMapMark[] = [];
    const seen = new Set<string>();
    const add = (systemId: string | undefined,
        kind: MissionMapMark['kind'], missionId: string) => {
        if (!systemId) {
            return;
        }
        const key = `${systemId}|${kind}|${missionId}`;
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        marks.push({ systemId, kind, missionId });
    };
    for (const active of missions) {
        const mission = getMission(active.id);
        if (!mission) {
            continue;
        }
        if (!mission.flags.hideDestArrows) {
            if (active.travelPlanet) {
                add(systemOfStellar(active.travelPlanet),
                    'destination', active.id);
            }
            if (active.returnPlanet) {
                add(systemOfStellar(active.returnPlanet),
                    'destination', active.id);
            }
        }
        if (mission.flags.showArrowForShipSyst
            && active.shipObjective?.systemId) {
            add(active.shipObjective.systemId, 'shipSyst', active.id);
        }
    }
    return marks;
}

/**
 * Builds a concrete offer for a mission that matches this location,
 * freezing random destination and cargo choices. Returns null when a
 * destination cannot be resolved.
 */
export function makeMissionOffer(mission: MissionData,
    ctx: MissionContext): MissionOffer | null {
    const travelPlanet = resolveStellarRef(mission.travelStel,
        mission.travelStelId, mission, ctx, false);
    if (travelPlanet === undefined) {
        return null;
    }
    const returnPlanet = resolveStellarRef(mission.returnStel,
        mission.returnStelId, mission, ctx, true);
    if (returnPlanet === undefined) {
        return null;
    }
    // Special ships: freeze the spawn system and goal state. null
    // means unresolvable (or an unsupported goal): unofferable.
    const shipObjective = resolveShipObjective(mission, ctx,
        travelPlanet, returnPlanet);
    if (shipObjective === null) {
        return null;
    }

    let cargoType = mission.cargoType;
    if (cargoType === 1000) {
        cargoType = Math.floor(ctx.random() * 6);
    }
    let cargoQty = 0;
    if (cargoType >= 0) {
        if (mission.cargoQty >= 0) {
            cargoQty = mission.cargoQty;
        } else if (mission.cargoQty <= -2) {
            // abs(value) tons plus or minus 50%.
            const base = Math.abs(mission.cargoQty);
            cargoQty = Math.max(1,
                Math.round(base / 2 + ctx.random() * base));
        }
    }
    if (cargoQty === 0) {
        cargoType = -1;
    }

    const offer: MissionOffer = {
        data: mission,
        travelPlanet,
        returnPlanet,
        cargoType,
        cargoQty,
        shipObjective,
        acceptable: true,
    };

    // mïsn Flags2 0x0001 (EVN Bible): "Don't offer mission if the player
    // doesn't have enough cargo space to hold the mission cargo (even if
    // the mission cargo won't be picked up until later)". The parenthetical
    // is why this is NOT conditioned on the cargo loading now: a PickupMode
    // 1/2 mission (nova:429-433 "Federation Resupply", the United Shipping
    // deliveries) offered to a hold that cannot take its cargo would be
    // accepted, flown to its travel stellar, and stall there when
    // loadMissionCargo fails with no popup to say why. The "must fit NOW"
    // check for PickupMode 0 is checkAcceptable's, below.
    if (cargoQty > 0 && cargoQty > ctx.freeCargoSpace
        && mission.flags.notOfferedIfInsufficientCargoSpace) {
        return null;
    }
    const check = checkAcceptable(offer, ctx);
    if (!check.acceptable) {
        offer.acceptable = false;
        offer.reason = check.reason;
    }
    return offer;
}

/**
 * Re-evaluates whether an offer can be accepted against the CURRENT
 * context (cargo already committed by other accepted missions, current
 * active-mission count). `makeMissionOffer` freezes `acceptable` at
 * board-open; this is called again at accept time so a second cargo
 * mission can't slip past a now-full hold, and the 16-mission cap can't
 * be exceeded by a stale offer (L3/L4).
 */
export function checkAcceptable(offer: MissionOffer, ctx: MissionContext):
    { acceptable: true } | { acceptable: false; reason: string } {
    const mission = offer.data;
    // Cargo picked up at mission start must fit now.
    const loadsNow = offer.cargoQty > 0
        && (mission.pickupMode === 0 || mission.pickupMode === -1);
    if (loadsNow && offer.cargoQty > ctx.freeCargoSpace) {
        return {
            acceptable: false,
            reason: `You need ${offer.cargoQty} tons of free cargo space `
                + `to accept this mission.`,
        };
    }
    if (ctx.activeMissions.size >= MAX_ACTIVE_MISSIONS) {
        return {
            acceptable: false,
            reason: `You cannot take on more than `
                + `${MAX_ACTIVE_MISSIONS} missions at once.`,
        };
    }
    return { acceptable: true };
}

/** An observable consequence of mission processing, for the UI. */
export interface MissionEvent {
    missionId: string;
    missionName: string;
    type: 'completed' | 'failed' | 'aborted' | 'accepted' | 'autoAborted'
        | 'shipDone' | 'cargoLoaded' | 'cargoDropped';
    /** The mission's dësc text for this event ('' if none). */
    text: string;
    /**
     * The global PICT id of the dësc Graphic paired with `text`, shown
     * beside it in the result popup (completion/fail/shipDone), or absent
     * when that dësc has no graphic. Already a resolved global id from the
     * misn parser (misn_parse.ts descGraphic), so it needs no prefixing.
     */
    pict?: string | null;
    /** Credits paid (positive) with this event, if any. */
    payment?: number;
    /**
     * The mission's special-ship name (ActiveMission.shipName), so the
     * landing popups can expand <SN> in completion/failure/ShipDone/
     * cargo texts — stock missions do use it there (e.g. mïsn nova:158
     * and nova:159, the Polaris "Watch Wraith Talks" pair). The event
     * is the only mission shape those popups get; absent when the
     * mission has no ShipNameID list.
     */
    specialShipName?: string;
    /**
     * For cargo events: which stop the transfer happened at. 'return' is
     * the DropOffMode 1 drop at the mission's end, where "here" is the
     * RETURN stellar (the mission is already gone from the player's state
     * when the popup is shown, so the popup can't look it up).
     */
    stop?: 'travel' | 'return';
}

/**
 * The player-local mutable state mission processing operates on.
 * These are working copies (the spaceport commit pattern): the caller
 * builds them from the entity's components and commits them back.
 */
export interface MissionWorkingState {
    missions: Missions;
    cargo: Cargo;
    credits: { credits: number };
    bits: Set<number>;
    /** Total cargo capacity in tons (not free space). */
    cargoCapacity: number;
    /** Days the game date should be advanced (DatePostInc), summed. */
    dateAdvance: number;
    events: MissionEvent[];
    /**
     * The player's legal records, for CompReward and the PayVal
     * record-cleaning encodings. Optional so bare test states keep
     * working; reputation effects are skipped when absent.
     */
    records?: LegalRecords;
    /**
     * The player's active ranks, for the Kxxx/Lxxx set operators
     * (rank_logic.ts). Optional so bare test states keep working; rank
     * activation is then reported as an unimplemented hook, exactly as it
     * was before ranks existed.
     */
    ranks?: ActiveRanks;
    /**
     * Special-ship batches of missions that auto-aborted at accept while
     * docked, waiting for lift-off (PendingAutoAbortShipsComponent).
     * acceptOffer appends; MissionSession seeds and commits it. Optional so
     * bare test states keep working — without it an auto-abort's ships are
     * simply not recorded, as before.
     */
    autoAbortShips?: PendingAutoAbortShip[];
}

export interface MissionMachineryContext {
    state: MissionWorkingState;
    /**
     * Cached mission data lookup (warm the cache first). Doubles as the
     * missions-exists lookup the Sxxx/Axxx/Fxxx operators resolve their
     * bare numbers through (resolveNumberedResource, stock-first), so it
     * must answer for every loaded mission — MissionUniverse's
     * missionsById does.
     */
    getMission(id: string): MissionData | undefined;
    /** Context for resolving Sxxx-started missions' destinations. */
    offerContext(): MissionContext;
    random(): number;
    /**
     * Every govt (deterministic order), for ally/classmate scopes of
     * the PayVal record-cleaning encodings. Optional; cleaning
     * degrades to the named govt only when absent.
     */
    allGovts?(): Iterable<readonly [string, GovtData]>;
    /**
     * Whether two stellar ids denote the "same stellar" — identical name
     * and map coordinates — so landing on one fulfils a travel/return
     * objective set to the other (EVN Bible, TravelStel/ReturnStel: "the
     * mission travel objectives will also be fulfilled when landing on a
     * duplicate stellar that has the idendical name and coordinates to the
     * stellar you specify here"). Optional; without it only exact-id
     * matches complete a landing.
     */
    sameStellar?(a: string, b: string): boolean;
    /**
     * Resolves a global rank id to its data, so the Kxxx/Lxxx operators can
     * run the Bible's deactivation cascades. Doubles as the ranks-exists
     * lookup those operators resolve their bare numbers through
     * (resolveNumberedResource, stock-first), so it must answer for every
     * loaded rank — MissionUniverse's ranksById does. Optional; without it
     * a rank is still activated/deactivated under the writer's own prefix,
     * just with no cascade (rank_logic.ts records unresolvable ranks
     * rather than dropping player state).
     */
    getRank?(id: string): RankData | undefined;
    /**
     * Whether an oütf with this global id exists, so `Gxxx` / `Dxxx` can
     * resolve their bare numbers stock-first like every other numeric
     * reference (resolveNumberedResource). Optional; without it a plug-in's
     * number always means that plug-in's own outfit.
     */
    outfitExists?(globalId: string): boolean;
    /**
     * `Xxxx` ("make system ID xxx be explored"): the player's per-system
     * discovery record. Player-local display/save state, threaded in like
     * the outfits map rather than imported (see discovery.ts's
     * DiscoveryAccess). Optional; without it `Xxxx` is reported as an
     * unimplemented hook, as it was before this existed.
     */
    discovery?: DiscoveryAccess;
    /**
     * Whether a sÿst with this global id exists, so `Xxxx` resolves its
     * bare number stock-first and ignores a number no data set defines.
     */
    systemExists?(globalId: string): boolean;
    /**
     * `Cxxx` / `Exxx` / `Hxxx` (change the player's ship to type xxx; the
     * three outfit treatments are spaceport/shipyard_rules' ShipChangeMode).
     * The ship is an ENTITY swap, which only the venue holding the docked
     * entity can perform, so this is supplied by that venue (the
     * outfitter, for an oütf OnPurchase like stock 314's `H165`) and is
     * otherwise reported as an unimplemented hook. `globalShipId` is
     * already resolved stock-first through `shipExists`.
     */
    changeShip?(globalShipId: string,
        mode: 'keep' | 'keepAndGrantDefaults' | 'dropAndGrantDefaults'): void;
    /**
     * Whether a shïp with this global id exists, so the change-ship
     * operators resolve their bare number stock-first like every other
     * numeric reference.
     */
    shipExists?(globalId: string): boolean;
}

/**
 * The gövt a mission's bare CompGovt / PayVal number names, resolved the
 * same way an AvailStel govt range resolves one (`rangeGovt`, and
 * stock-first {@link resolveNumberedResource} everywhere else): the
 * plug-in that WROTE the mission first — its own private govts live under
 * its prefix — then stock.
 *
 * THE FALLBACK IS WHAT MAKES AN OVERRIDE WORK. A plug-in that overrides a
 * stock mïsn keeps the stock id, so {@link setStringPrefix} answers with
 * the plug-in's writerPrefix while the gövt the number names is still
 * `nova:n`. Keyed on the writer alone, the reputation change landed on a
 * phantom `<plug>:n` record that no gövt backs — an entry the player-info
 * dialog cannot name and nothing else ever reads — and PayVal's
 * record-cleaning silently did nothing at all, because `cleanRecords`
 * returns early when the govt does not resolve.
 *
 * Returns the writer-prefixed id when NEITHER resolves, which is the
 * pre-existing behaviour for a number no loaded data set defines.
 */
function missionGovt(machinery: MissionMachineryContext,
    mission: MissionData, n: number):
    { id: string, data: GovtData | undefined } {
    const getGovt = machinery.offerContext().getGovt;
    const own = `${setStringPrefix(mission)}:${n}`;
    const ownData = getGovt(own);
    if (ownData) {
        return { id: own, data: ownData };
    }
    const stock = `nova:${n}`;
    const stockData = getGovt(stock);
    return stockData ? { id: stock, data: stockData }
        : { id: own, data: undefined };
}

/**
 * Applies a mission outcome's CompGovt/CompReward record change
 * (Bible: complete grants CompReward; failure costs half — "that govt
 * will take it personally"; abort costs 5x under mïsn flag 0x0040).
 */
function applyOutcomeReputation(machinery: MissionMachineryContext,
    mission: MissionData, outcome: 'complete' | 'fail' | 'abort'): void {
    const { state } = machinery;
    if (!state.records || mission.compGovt < 128) {
        return;
    }
    const delta = compRewardDelta(mission.compReward, outcome,
        mission.flags.lose5xCompRewardOnAbort);
    if (delta === 0) {
        return;
    }
    const govt = missionGovt(machinery, mission, mission.compGovt);
    addRecord(state.records, govt.id, govt.data, delta);
}

function freeCargoSpace(state: MissionWorkingState): number {
    return state.cargoCapacity - cargoUsed(state.cargo);
}

function loadMissionCargo(state: MissionWorkingState,
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

function unloadMissionCargo(state: MissionWorkingState,
    active: ActiveMission): void {
    state.cargo.delete(missionCargoKey(active.id));
    active.cargoLoaded = false;
}

/**
 * Builds the NCB set hooks for running mission set strings: bit
 * mutation plus the mission operators Sxxx/Axxx/Fxxx wired to the
 * real machinery. `runningMissionPrefix` scopes numeric ids to the
 * plug-in that defined the running expression.
 *
 * Outfit granting (Gxxx/Dxxx) is only wired when the caller supplies
 * an outfits map (the mission board does; landing processing does), and
 * system exploration (Xxxx) only when it supplies a discovery record.
 */
export function makeMissionSetHooks(machinery: MissionMachineryContext,
    runningMissionPrefix: string,
    outfits?: Map<string, number>, depth = 0): NCBSetHooks {
    const { state } = machinery;
    // Kxxx/Lxxx resolve their ränk number stock-first, exactly like every
    // sibling operator (resolveNumberedResource, keyed on the WRITING
    // plug-in's prefix): stock's rank n when stock defines it, else the
    // writer's own — which is also the id recorded when NEITHER defines n
    // (activateRank keeps unknown ids so a not-loaded plug-in's rank
    // survives a save; the writer's id is the one it would come back to).
    const rankExists = machinery.getRank
        && ((globalId: string) => machinery.getRank!(globalId) !== undefined);
    const hooks = makeControlBitHooks(state.bits, outfits ? {
        outfits,
        resolveId: id => resolveNumberedResource(
            id, runningMissionPrefix, machinery.outfitExists),
    } : undefined, state.ranks ? {
        active: state.ranks,
        resolveId: id => resolveNumberedResource(
            id, runningMissionPrefix, rankExists),
        getRank: id => machinery.getRank?.(id),
    } : undefined, systemDiscoveryOperators(machinery.discovery,
        runningMissionPrefix, machinery.systemExists));

    // Cxxx/Exxx/Hxxx, when the caller can swap the player's hull (the
    // outfitter can; see MissionMachineryContext.changeShip). The shïp
    // number resolves stock-first like every sibling operator.
    const { changeShip } = machinery;
    if (changeShip) {
        hooks.changeShip = (id, mode) => changeShip(resolveNumberedResource(
            id, runningMissionPrefix, machinery.shipExists), mode);
    }

    if (depth > 4) {
        // Guard against Sxxx/Axxx/Fxxx cycles in scripting.
        return hooks;
    }

    // Sxxx/Axxx/Fxxx resolve their mïsn number the same stock-first way
    // (getMission doubles as the missions-exists lookup; MissionUniverse
    // keeps missionsById). A plug-in's S<stock-n> starts nova:n rather
    // than warning about a phantom id under the plug-in's own prefix.
    const resolveMissionId = (id: number) => resolveNumberedResource(
        id, runningMissionPrefix,
        globalId => machinery.getMission(globalId) !== undefined);
    hooks.startMission = id => {
        startMissionById(machinery, resolveMissionId(id), outfits, depth + 1);
    };
    hooks.abortMission = id => {
        const globalId = resolveMissionId(id);
        if (state.missions.has(globalId)) {
            abortMission(machinery, globalId, outfits, depth + 1);
        }
    };
    hooks.failMission = id => {
        const globalId = resolveMissionId(id);
        if (state.missions.has(globalId)) {
            failMission(machinery, globalId, outfits, depth + 1);
        }
    };
    return hooks;
}

export function runMissionSetString(machinery: MissionMachineryContext,
    expression: string, missionPrefix: string,
    outfits?: Map<string, number>, depth = 0): void {
    if (!expression) {
        return;
    }
    try {
        runNCBSet(expression,
            makeMissionSetHooks(machinery, missionPrefix, outfits, depth),
            machinery.random);
    } catch (e) {
        if (e instanceof NCBParseError) {
            console.warn('Bad mission set string:', e.message);
            return;
        }
        throw e;
    }
}

/**
 * Picks the special ships' name for a mission being accepted, from
 * the mïsn's ShipNameID STR# list (MissionData.shipNames; empty when
 * ShipNameID is -1). Undefined when the mission names no list — the
 * ships then get their normal random names and <SN> has nothing to
 * expand to.
 *
 * The EVN Bible's <SN> note fixes the timing: "Nova will screw up if
 * you use this in the initial mission description, as it doesn't pick
 * the special ship names until you actually accept the mission." The
 * pick is therefore made HERE, at accept, and frozen on the
 * ActiveMission so text and ships agree for the mission's whole life
 * (including across saves and system re-entries, which respawn the
 * ships).
 *
 * ONE name per mission, shared by all its special ships: the Bible's
 * ShipNameID line is singular about the name and plural about the
 * ships ("Tells Nova how to name the special ships ... Pick a name
 * from this STR# resource"), <SN> itself is singular, and the only
 * stock multi-ship text that uses it reads "I believe most of them
 * have been named <SN>" (mïsn nova:353) — i.e. one name covering the
 * group. No stock mission combines ShipCount > 1 with a ShipNameID,
 * so nothing in the data contradicts the simpler reading.
 *
 * Player-local randomness, like the AvailRandom offer roll
 * (mission_offers.ts): the result is committed into the player's
 * mission state and mirrors to peers through that state, never
 * through a sim PRNG draw.
 */
function pickSpecialShipName(mission: MissionData,
    random: () => number): string | undefined {
    return pickFromStrList(mission.shipNames, random);
}

/**
 * The ShipSubtitle sibling of pickSpecialShipName: "Tells Nova which
 * subtitle, if any, to use for the special ships ... Pick a subtitle
 * from this STR# resource". Picked at accept and frozen for the same
 * reason, and — like the name — ONE subtitle covers all of the
 * mission's special ships. The original's own pilot file settles that:
 * an in-progress mission records a single specialShipNameIndex /
 * specialShipSubtitleIndex (and a single resolved specialShipName /
 * specialShipSubtitle string) per mission, not one per ship.
 *
 * Unlike the name there is no wildcard for it — it exists only to be
 * shown on the ships themselves (mïsn nova:685, "Assassinate Krane",
 * names no ships at all and subtitles them "Krane").
 */
function pickSpecialShipSubtitle(mission: MissionData,
    random: () => number): string | undefined {
    return pickFromStrList(mission.shipSubtitles, random);
}

function pickFromStrList(entries: readonly string[],
    random: () => number): string | undefined {
    if (entries.length === 0) {
        return undefined;
    }
    return entries[Math.floor(random() * entries.length)];
}

/**
 * Whether a mission's auto-abort (mïsn Flags 0x0001) is DEFERRED to the
 * boarding of its special ship rather than firing at accept.
 *
 * The Bible, verbatim: "If the mission is one in which a special ship
 * replaces a përs ship at mission start (such as for a 'rescue disabled
 * ship' mission) and the SpecialShipGoal is 2 or 5 (board or rescue) the
 * mission will auto-abort after the special ship is boarded."
 *
 * The checkable half of that sentence is the goal, and it is the half
 * that matters: the same paragraph already requires special ships for an
 * auto-abort to trigger at all ("there must be special ships associated
 * with the mission to trigger the auto-abort"), and a board/rescue goal
 * is only satisfiable by boarding a ship that exists. The përs-
 * replacement half is not re-checked here because acceptOffer does not
 * know which përs offered the mission — and a board/rescue auto-abort
 * mission with no përs behind it would otherwise abort instantly, before
 * its own goal could ever be met.
 *
 * A deferred mission therefore BECOMES ACTIVE like any other, so its
 * special ship spawns and can be found; MissionShipTrackSystem fires the
 * abort when the owner boards it.
 */
export function deferredAutoAbort(mission: MissionData): boolean {
    return mission.flags.autoAbort && mission.shipCount > 0
        && (mission.shipGoal === GOAL_BOARD
            || mission.shipGoal === GOAL_RESCUE);
}

/**
 * The DECODED mïsn Flags2 0x0002 ("Apply mission Pay on auto-abort")
 * effects a DEFERRED auto-abort freezes onto its ActiveMission, for the
 * simulation to apply the tick the special ship is boarded.
 *
 * The decoded effect is frozen, never the raw PayVal, for the same reason
 * `failIfPlayerDisabledOrDestroyed` is frozen: the simulation never reads
 * mission game data, so it cannot decode a PayVal itself — and the old
 * `payVal > 0 ? payVal : undefined` threw away every negative encoding on
 * the way past. Both fields here are pure arithmetic on the synced
 * CreditsComponent, which is why they are the sim's half at all.
 *
 * NOT frozen, deliberately: `cleanRecord` (PayVal -10128 and friends),
 * which needs the government table, and `takeCredits`, which the Bible
 * applies at mission START — a deferred auto-abort mission really does
 * start, so acceptOffer's normal takeCredits already spent it. See
 * runPendingAutoAborts for the record-cleaning half.
 */
function autoAbortPayEffects(mission: MissionData):
    { autoAbortPay?: number, autoAbortTakePercent?: number } {
    if (!mission.flags.applyPayOnAutoAbort) {
        return {};
    }
    const pay = decodePayVal(mission.payVal);
    if (pay.type === 'credits') {
        return { autoAbortPay: pay.amount };
    }
    if (pay.type === 'takePercent') {
        return { autoAbortTakePercent: pay.percent };
    }
    return {};
}

/**
 * Applies one decoded mïsn PayVal to the working state, and returns the
 * credits PAID (for the notice's <PAY> and the popup's "payment" line) —
 * `undefined` for every encoding that pays nothing.
 *
 * THE ONE PLACE THE FOUR ENCODINGS ARE SPENT. The Bible gives PayVal five
 * readings (see decodePayVal) and only one of them is "hand the player
 * money"; the other three take money or clean a record. Completion, the
 * immediate auto-abort, and the deferred auto-abort's player-local half all
 * route through here so a mission that costs 2% of your cash costs it
 * wherever it is settled. Splitting the arithmetic out is what fixed the
 * auto-abort paths, which used to test `payVal > 0` and so silently
 * discarded every negative encoding — including the stock "Drop Bear" trap
 * (mïsn nova:609/610, PayVal -40002/-40005) and mïsn nova:731's 50% fine.
 *
 * `takeCredits` is the odd one out in WHEN it applies (mission start, not
 * completion), not in HOW, so callers decide whether it is theirs to spend;
 * the arithmetic still lives here. Both takes clamp at zero: EV Nova has no
 * debt.
 */
function applyPayVal(machinery: MissionMachineryContext,
    mission: MissionData, pay: PayValEffect): number | undefined {
    const { state } = machinery;
    switch (pay.type) {
        case 'credits':
            state.credits.credits += pay.amount;
            return pay.amount;
        case 'takePercent':
            state.credits.credits -= Math.trunc(
                state.credits.credits * pay.percent / 100);
            return undefined;
        case 'takeCredits':
            state.credits.credits = Math.max(0,
                state.credits.credits - pay.amount);
            return undefined;
        case 'cleanRecord':
            if (state.records) {
                cleanRecords(state.records, pay.scope,
                    missionGovt(machinery, mission, pay.govtResourceId).data,
                    machinery.allGovts?.() ?? []);
            }
            return undefined;
        case 'none':
            return undefined;
    }
}

/** The result of an accept attempt (see acceptOffer). */
export type AcceptResult =
    | { accepted: true }
    | { accepted: false; reason: string };

/**
 * Accepts an offer: registers the active mission, loads start-time
 * cargo, runs OnAccept, and handles auto-abort missions (which run
 * their effects and never stay active).
 *
 * The offer's `acceptable` flag is frozen at board-open; a normal
 * (staying) mission is re-checked against the CURRENT context here so a
 * stale offer can't slip cargo past a hold another accepted mission has
 * since filled, or exceed the 16-mission cap (L3/L4). When the re-check
 * fails, nothing is committed and the reason is returned for the UI.
 * `skipAcceptabilityCheck` is for scripted starts (Sxxx), which ignore
 * availability by contract and gate the cap themselves.
 */
export function acceptOffer(machinery: MissionMachineryContext,
    offer: MissionOffer, outfits?: Map<string, number>, depth = 0,
    skipAcceptabilityCheck = false): AcceptResult {
    const { state } = machinery;
    const mission = offer.data;
    const prefix = setStringPrefix(mission);
    const ctx = machinery.offerContext();

    if (mission.flags.autoAbort && !deferredAutoAbort(mission)) {
        // One-shot scripting missions: run OnAccept (and pay if
        // flagged), never becoming active.
        runMissionSetString(machinery, mission.onAccept, prefix,
            outfits, depth);
        // ...and then OnAbort, because it IS an abort. EVN Bible, Flags
        // 0x0001: "automatically abort itself after it is accepted ... Any
        // control bits pointed to by the mission's OnAbort fields will be
        // automatically set when the mission aborts." OnAccept first, then
        // OnAbort, is the order the flag's own wording gives, and the
        // stock data is authored for it: nova:609 "Drop Bear" sets b45 on
        // accept and clears it on abort so it can score AGAIN (its
        // AvailBits are `(b42 & !b45) & ...`), nova:610 mirrors that with
        // b43, and nova:909 "Eamon Boarding" carries its whole consequence
        // — `K152 L138`, Sworn Enemy of the Wild Geese — in OnAbort alone.
        //
        // NOT applied: the CompReward abort reversal (applyOutcomeReputation
        // 'abort', mïsn Flags 0x0040). The Bible's auto-abort text names
        // only the OnAbort BITS, and all sixteen stock enforcement-squad
        // missions (nova:614-629, "Avoid Federation Task Force" and kin)
        // set 0x0040 with CompRewards up to 30 — applying a -150 Rebel
        // reversal every time a squad is dispatched cannot be what their
        // author meant. The DEFERRED auto-abort (runPendingAutoAborts) does
        // apply it, through abortMission; that asymmetry is deliberate and
        // recorded here.
        runMissionSetString(machinery, mission.onAbort, prefix,
            outfits, depth);
        // mïsn Flags2 0x0002, "Apply mission Pay on auto-abort". The Pay
        // is the WHOLE PayVal, not just a positive one: the stock traps
        // that use this bit are the ones that TAKE — nova:609/610 take 2%
        // and 5% of the player's cash ("GOTCHA!! Auroran Drop Bear scores
        // again..."), nova:731 takes 50%, and nova:896 cleans the player's
        // Federation record. Everything the flag covers is settled here,
        // `takeCredits` included: this mission never becomes active, so
        // accept IS its start and its end, and the start-time encoding has
        // nowhere else to fire. Without the flag no PayVal effect applies
        // at all, which is what the bit means.
        let payment: number | undefined;
        if (mission.flags.applyPayOnAutoAbort) {
            payment = applyPayVal(machinery, mission,
                decodePayVal(mission.payVal));
        }
        state.dateAdvance += Math.max(0, mission.datePostInc);
        // An auto-abort mission never becomes active, so its <SN> pick
        // lives only as long as this popup — and as long as the ships
        // below, which wear the same name.
        const shipName = pickSpecialShipName(mission, machinery.random);
        state.events.push({
            missionId: mission.id,
            missionName: mission.name,
            type: 'autoAborted',
            text: mission.briefText,
            // The autoAborted popup shows briefText, so pair it with the
            // briefing dësc's graphic (not failPict) to keep the picture
            // consistent with the text beside it.
            pict: mission.briefPict,
            payment,
            specialShipName: shipName,
        });
        // The ships, which are the reason an auto-abort mission has them
        // ("sometimes useful to create special ships" — EVN Bible, Flags
        // 0x0001): the mission is gone but its frozen objective is kept
        // for the lift-off to spawn from, exactly as the in-flight accept
        // keeps the offer's objective for the Derelict Decoy's ambush
        // (ship_mission_accept.ts). See PendingAutoAbortShipsComponent.
        if (offer.shipObjective && state.autoAbortShips) {
            const shipSubtitle =
                pickSpecialShipSubtitle(mission, machinery.random);
            state.autoAbortShips.push({
                missionId: mission.id,
                shipObjective: {
                    ...offer.shipObjective,
                    live: new Map(offer.shipObjective.live),
                },
                travelPlanet: offer.travelPlanet,
                returnPlanet: offer.returnPlanet,
                ...(shipName !== undefined ? { shipName } : {}),
                ...(shipSubtitle !== undefined ? { shipSubtitle } : {}),
            });
        }
        return { accepted: true };
    }

    // Re-evaluate cargo fit + the mission cap against current state: the
    // frozen offer may no longer be acceptable.
    if (!skipAcceptabilityCheck) {
        const check = checkAcceptable(offer, ctx);
        if (!check.acceptable) {
            return { accepted: false, reason: check.reason };
        }
    }

    const active: ActiveMission = {
        id: mission.id,
        acceptedDay: ctx.currentDay,
        acceptedAt: ctx.stellar.id,
        travelPlanet: offer.travelPlanet,
        returnPlanet: offer.returnPlanet,
        cargoType: offer.cargoType,
        cargoQty: offer.cargoQty,
        cargoLoaded: false,
        travelDone: false,
        deadlineDay: mission.timeLimit > 0
            ? ctx.currentDay + mission.timeLimit
            : null,
        // Frozen so the shared sim can fail the mission on a player
        // disable/destroy without reading mission game data.
        failIfPlayerDisabledOrDestroyed:
            mission.flags.failIfPlayerDisabledOrDestroyed,
        // mïsn Flags 0x8000 "Mission will fail if player is boarded by
        // pirates", frozen for the same reason (MissionPlayerPlunderedSystem
        // reads it). Only written when set, so the record stays additive.
        ...(mission.flags.failIfBoardedByPirates
            ? { failIfBoardedByPirates: true } : {}),
        // Copied (not aliased) so re-showing the offer stays pristine.
        shipObjective: offer.shipObjective && {
            ...offer.shipObjective,
            live: new Map(offer.shipObjective.live),
        },
        // <SN>: the special ships' name, picked now (see
        // pickSpecialShipName) and frozen for the mission's life.
        shipName: pickSpecialShipName(mission, machinery.random),
        // ...and the subtitle shown beneath it on those same ships.
        shipSubtitle: pickSpecialShipSubtitle(mission, machinery.random),
        // mïsn PickupMode 2, "Pick up when boarding special ship" —
        // frozen here for the same reason failIfPlayerDisabledOrDestroyed
        // is: the pickup happens in the SHARED SIMULATION, the tick the
        // owner boards the ship, and the sim never reads mission game
        // data. See MissionShipTrackSystem.
        pickupOnBoard: mission.pickupMode === 2 ? true : undefined,
        // The DEFERRED auto-abort (see deferredAutoAbort), with the two
        // numeric effects the sim applies on that boarding frozen beside
        // it. Both are Bible flags: Flags2 0x0002 "Apply mission Pay on
        // auto-abort" and Flags 0x0008 "Mission takes away 100 units of
        // fuel upon auto-abort".
        ...(deferredAutoAbort(mission) ? {
            autoAbortOnBoard: true,
            ...autoAbortPayEffects(mission),
            autoAbortFuel: mission.flags.remove100FuelOnAutoAbort
                ? AUTO_ABORT_FUEL_COST : undefined,
        } : {}),
    };
    state.missions.set(mission.id, active);
    if (offer.cargoQty > 0
        && (mission.pickupMode === 0 || mission.pickupMode === -1)) {
        loadMissionCargo(state, active);
    }
    // PayVal -50000 and down: take credits at mission START (the only
    // PayVal encoding that applies before completion). Clamped at 0 —
    // EV Nova has no debt.
    const pay = decodePayVal(mission.payVal);
    if (pay.type === 'takeCredits') {
        applyPayVal(machinery, mission, pay);
    }
    runMissionSetString(machinery, mission.onAccept, prefix, outfits, depth);
    state.events.push({
        missionId: mission.id,
        missionName: mission.name,
        type: 'accepted',
        text: mission.briefText,
        specialShipName: active.shipName,
    });
    return { accepted: true };
}

/** Refusing an offer just runs OnRefuse. */
export function refuseOffer(machinery: MissionMachineryContext,
    offer: MissionOffer, outfits?: Map<string, number>): void {
    runMissionSetString(machinery, offer.data.onRefuse,
        setStringPrefix(offer.data), outfits);
}

/** Sxxx: start a mission by id, ignoring availability. */
export function startMissionById(machinery: MissionMachineryContext,
    missionId: string, outfits?: Map<string, number>, depth = 0): void {
    const { state } = machinery;
    const mission = machinery.getMission(missionId);
    if (!mission) {
        console.warn(`Sxxx: mission ${missionId} is not loaded; ignoring.`);
        return;
    }
    if (state.missions.has(missionId)
        || state.missions.size >= MAX_ACTIVE_MISSIONS) {
        return;
    }
    const offer = makeMissionOffer(mission, machinery.offerContext());
    if (!offer) {
        console.warn(`Sxxx: could not resolve destinations for ${missionId}.`);
        return;
    }
    // Scripted starts ignore availability (cargo fit): the cap is gated
    // above. Skip the accept-time re-check so a full hold can't silently
    // block a story mission the way it blocks a board accept.
    acceptOffer(machinery, offer, outfits, depth, true);
}

/** Axxx / the abort button: run OnAbort, drop cargo, remove. */
export function abortMission(machinery: MissionMachineryContext,
    missionId: string, outfits?: Map<string, number>, depth = 0): void {
    const { state } = machinery;
    const active = state.missions.get(missionId);
    if (!active) {
        return;
    }
    state.missions.delete(missionId);
    unloadMissionCargo(state, active);
    const mission = machinery.getMission(missionId);
    if (mission) {
        applyOutcomeReputation(machinery, mission, 'abort');
        runMissionSetString(machinery, mission.onAbort,
            setStringPrefix(mission), outfits, depth);
    }
    state.events.push({
        missionId,
        missionName: mission?.name ?? missionId,
        type: 'aborted',
        text: '',
    });
}

/** Fxxx / deadline passed: run OnFailure, drop cargo, remove. */
export function failMission(machinery: MissionMachineryContext,
    missionId: string, outfits?: Map<string, number>, depth = 0): void {
    const { state } = machinery;
    const active = state.missions.get(missionId);
    if (!active) {
        return;
    }
    state.missions.delete(missionId);
    unloadMissionCargo(state, active);
    const mission = machinery.getMission(missionId);
    if (mission) {
        applyOutcomeReputation(machinery, mission, 'fail');
        runMissionSetString(machinery, mission.onFailure,
            setStringPrefix(mission), outfits, depth);
    }
    state.events.push({
        missionId,
        missionName: mission?.name ?? missionId,
        type: 'failed',
        text: mission?.failText ?? '',
        pict: mission?.failPict ?? null,
        specialShipName: active.shipName,
    });
}

function completeMission(machinery: MissionMachineryContext,
    active: ActiveMission, mission: MissionData,
    outfits?: Map<string, number>): void {
    const { state } = machinery;
    state.missions.delete(active.id);
    // DropOffMode 1: "Drop off at mission end (ReturnStel)". The original
    // shows the DropCargText here, BEFORE the CompText — and it does so
    // whether or not the mission carries any cargo: 52 stock missions
    // (e.g. mïsn nova:167/172, the Polaris martial-arts pair) have no
    // cargo, DropOffMode 1 and a DropCargText, and land to two boxes in a
    // row. Per the Bible's note the drop only happens if the cargo was
    // picked up (vacuously true with no cargo); the ship-goal condition
    // is already met by the time completion is reached.
    if (mission.dropOffMode === 1 && mission.dropOffCargoText
        && (active.cargoQty <= 0 || active.cargoLoaded)) {
        state.events.push({
            missionId: mission.id,
            missionName: mission.name,
            type: 'cargoDropped',
            text: mission.dropOffCargoText,
            pict: mission.dropOffCargoPict,
            specialShipName: active.shipName,
            stop: 'return',
        });
    }
    unloadMissionCargo(state, active);
    // PayVal: credits, record cleaning, or cash removal (the Bible's
    // negative encodings; takeCredits already applied at accept, so it is
    // the one encoding completion does NOT spend).
    const pay = decodePayVal(mission.payVal);
    const payment = pay.type === 'takeCredits' ? undefined
        : applyPayVal(machinery, mission, pay);
    applyOutcomeReputation(machinery, mission, 'complete');
    state.dateAdvance += Math.max(0, mission.datePostInc);
    runMissionSetString(machinery, mission.onSuccess,
        setStringPrefix(mission), outfits);
    state.events.push({
        missionId: mission.id,
        missionName: mission.name,
        type: 'completed',
        text: mission.completionText,
        pict: mission.completionPict,
        payment,
        specialShipName: active.shipName,
    });
}

/**
 * Runs a mission's OnShipDone (and queues its ShipDoneText event) if the
 * shared sim flagged its ship goal complete (shipDonePending). The Bible
 * runs OnShipDone the moment the goal completes; the set string mutates
 * control bits player-locally, so the earliest deterministic, owner-
 * driven point is the next date advance (jump or landing). Clears the
 * pending flag so it runs exactly once.
 *
 * THE TEXT IS NOT DEFERRED — only the set string is. The owner's DISPLAY
 * shows the ShipDoneText at the moment the goal completes, off the same
 * `shipDonePending` flag (display/mission_ship_done_plugin.ts), which is
 * where the original shows it. The event queued here is still the one the
 * landing popups render, so processInFlightMissions drops it when the
 * client reports having already shown that text
 * (spaceport/ship_done_shown.ts) — belt and braces for the case where it
 * never got the chance (a quit between the two moments).
 */
function runShipDoneIfPending(machinery: MissionMachineryContext,
    active: ActiveMission, mission: MissionData,
    outfits?: Map<string, number>): void {
    const objective = active.shipObjective;
    if (!objective?.shipDonePending) {
        return;
    }
    objective.shipDonePending = false;
    runMissionSetString(machinery, mission.onShipDone,
        setStringPrefix(mission), outfits);
    if (mission.shipDoneText) {
        machinery.state.events.push({
            missionId: mission.id,
            missionName: mission.name,
            type: 'shipDone',
            text: mission.shipDoneText,
            pict: mission.shipDonePict,
            specialShipName: active.shipName,
        });
    }
}

/**
 * Runs OnShipDone for every active mission whose ship goal just
 * completed (shipDonePending), appending any ShipDoneText events.
 * Called at each date advance (jump or landing) so OnShipDone fires at
 * the first player-local opportunity after the goal completes rather
 * than waiting for a landing. Returns how many ran.
 */
export function runPendingShipDone(machinery: MissionMachineryContext,
    outfits?: Map<string, number>): number {
    const { state } = machinery;
    let ran = 0;
    for (const active of [...state.missions.values()]) {
        // The loop iterates a snapshot; an earlier mission's OnShipDone
        // can abort/fail a later one via an Axxx/Fxxx set string, removing
        // it from state.missions mid-loop (abort/fail leave shipDonePending
        // untouched). Skip any mission that is no longer active so a dead
        // mission's OnShipDone (and shipDone event) never runs, mirroring
        // the guard failExpiredMissions gets for free from failMission's
        // early return. See mission_logic_test.ts (self/sibling abort).
        if (!state.missions.has(active.id)) {
            continue;
        }
        if (!active.shipObjective?.shipDonePending) {
            continue;
        }
        const mission = machinery.getMission(active.id);
        if (!mission) {
            continue;
        }
        runShipDoneIfPending(machinery, active, mission, outfits);
        ran++;
    }
    return ran;
}

/**
 * Runs the PLAYER-LOCAL half of a deferred auto-abort (mïsn Flags 0x0001
 * on a board/rescue-goal mission — see deferredAutoAbort).
 *
 * The simulation already did the parts it owns, the tick the owner
 * boarded the special ship: paying mïsn Flags2 0x0002's Pay, taking
 * Flags 0x0008's 100 units of fuel, and lifting the rescue target's
 * disable so it flies off (MissionShipTrackSystem's rescueBoarded). What
 * is left needs the mission UNIVERSE, which the sim cannot see: the
 * OnAbort set string, dropping the mission from the list, and its notice.
 * That is exactly the split `shipDonePending` already uses, so this runs
 * beside runPendingShipDone at every date advance.
 *
 * Reusing `abortMission` rather than open-coding it is what keeps the
 * deferred case honest: the Bible calls this an ABORT ("the mission will
 * auto-abort after the special ship is boarded"), so it must run OnAbort,
 * apply the abort reputation, and unload mission cargo like any other.
 * Returns how many ran.
 */
export function runPendingAutoAborts(machinery: MissionMachineryContext,
    outfits?: Map<string, number>): number {
    const { state } = machinery;
    let ran = 0;
    for (const active of [...state.missions.values()]) {
        // The snapshot can go stale under an earlier mission's set string
        // (the same hazard runPendingShipDone documents).
        if (!state.missions.has(active.id) || !active.autoAbortPending) {
            continue;
        }
        // The half of mïsn Flags2 0x0002's Pay that needs the government
        // table: PayVal's record-cleaning encodings. The sim already
        // settled the two arithmetic ones from the frozen
        // autoAbortPay/autoAbortTakePercent (autoAbortPayEffects); this
        // one is re-decoded from the mission data, which is exactly what
        // this side of the split has and the sim does not.
        const mission = machinery.getMission(active.id);
        if (mission?.flags.applyPayOnAutoAbort) {
            const pay = decodePayVal(mission.payVal);
            if (pay.type === 'cleanRecord') {
                applyPayVal(machinery, mission, pay);
            }
        }
        abortMission(machinery, active.id, outfits);
        ran++;
    }
    return ran;
}

/**
 * Fails every active mission whose deadline has passed as of
 * `currentDay`, or which the shared sim marked failed (`active.failed`).
 * Runs OnFailure and appends a failure event for each — the same as a
 * landing-time deadline failure, but callable at every date advance
 * (jump or landing) so a deadline that expires in flight fails the
 * moment it passes rather than at the next landing. Returns the number
 * of missions failed. Missions completing at their destination are left
 * to processLanding.
 */
export function failExpiredMissions(machinery: MissionMachineryContext,
    currentDay: number, outfits?: Map<string, number>): number {
    const { state } = machinery;
    let failed = 0;
    for (const active of [...state.missions.values()]) {
        const expired = active.deadlineDay !== null
            && currentDay > active.deadlineDay;
        if (expired || active.failed) {
            failMission(machinery, active.id, outfits);
            failed++;
        }
    }
    return failed;
}

/**
 * Processes a landing at `planetId` for every active mission:
 * deadline failures, travel-leg cargo transfer, and completion at the
 * return stellar (paying and running OnSuccess). Events are appended
 * to the working state for the UI.
 */
export function processLanding(machinery: MissionMachineryContext,
    planetId: string, currentDay: number,
    outfits?: Map<string, number>): void {
    const { state } = machinery;
    // Landing at `planetId` also satisfies an objective set to a duplicate
    // stellar (same name + coordinates), per the Bible. Threaded via
    // sameStellar so pure callers without topology keep exact-id matching.
    const landedAt = (destId: string | null): boolean =>
        destId !== null && (destId === planetId
            || (machinery.sameStellar?.(destId, planetId) ?? false));
    for (const active of [...state.missions.values()]) {
        // The loop iterates a snapshot; an earlier mission's OnSuccess (or
        // OnShipDone/OnAbort) can abort/fail/complete a later one via an
        // Axxx/Fxxx set string, removing it from state.missions mid-loop.
        // Skip any mission that is no longer active so we never re-process
        // (and re-pay) it.
        if (!state.missions.has(active.id)) {
            continue;
        }
        const mission = machinery.getMission(active.id);
        if (!mission) {
            console.warn(`Active mission ${active.id} has no data; skipping.`);
            continue;
        }
        if (active.deadlineDay !== null && currentDay > active.deadlineDay) {
            failMission(machinery, active.id, outfits);
            continue;
        }
        if (active.failed) {
            // The shared sim marked the mission failed (the owner was
            // disabled or destroyed under Flags2 0x0004).
            failMission(machinery, active.id, outfits);
            continue;
        }
        const objective = active.shipObjective;
        if (objective?.failed) {
            // The ship goal became unachievable (an escort died, a
            // disable target was destroyed).
            failMission(machinery, active.id, outfits);
            continue;
        }
        // OnShipDone normally runs at the previous date advance (jump or
        // landing) the moment the goal completed; this catches the case
        // where the goal completed at this very landing's date advance.
        runShipDoneIfPending(machinery, active, mission, outfits);
        // OnShipDone's set string can abort/fail THIS mission (an Axxx/Fxxx
        // naming itself, which the abort/fail hooks allow since it is still
        // active at that point). Re-check membership before falling through
        // to completion so a self-aborted mission isn't also completed —
        // which would pay PayVal and push a 'completed' event for a mission
        // that was just aborted. See mission_logic_test.ts (self-abort).
        if (!state.missions.has(active.id)) {
            continue;
        }
        if (landedAt(active.travelPlanet) && !active.travelDone) {
            let transferred = true;
            if (mission.pickupMode === 1) {
                transferred = loadMissionCargo(state, active);
                if (transferred && mission.loadCargoText) {
                    // The LoadCargText dësc, as a landing popup — without
                    // it, picking up the cargo is silent and the player
                    // can't tell the stop registered.
                    state.events.push({
                        missionId: mission.id,
                        missionName: mission.name,
                        type: 'cargoLoaded',
                        text: mission.loadCargoText,
                        pict: mission.loadCargoPict,
                        specialShipName: active.shipName,
                        stop: 'travel',
                    });
                }
            }
            if (mission.dropOffMode === 0) {
                unloadMissionCargo(state, active);
                if (mission.dropOffCargoText) {
                    // The DropCargText dësc (e.g. the Kontik probe's desc
                    // 8781) — the original shows it when the cargo is
                    // dropped at the travel stellar; landing "silently
                    // working" reads as the mission being stuck.
                    state.events.push({
                        missionId: mission.id,
                        missionName: mission.name,
                        type: 'cargoDropped',
                        text: mission.dropOffCargoText,
                        pict: mission.dropOffCargoPict,
                        specialShipName: active.shipName,
                        stop: 'travel',
                    });
                }
            }
            if (transferred) {
                active.travelDone = true;
            }
        }
        // A mission with no return stellar completes at its travel
        // stellar; with neither, it can only end by script or abort.
        const completionPlanet = active.returnPlanet ?? active.travelPlanet;
        const travelSatisfied = active.travelPlanet === null
            || active.travelDone;
        const goalSatisfied = !objective
            || objectiveAllowsCompletion(objective);
        if (landedAt(completionPlanet) && travelSatisfied
            && goalSatisfied) {
            completeMission(machinery, active, mission, outfits);
        }
    }
}
