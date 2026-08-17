import { GovtData } from 'novadatainterface/govt_data';
import { PlanetData } from 'novadatainterface/planet_data';
import { isInhabited } from './landable.js';
import { LegalRecords, recordWith } from './reputation.js';

/**
 * ============================================================================
 * Landing clearance — the ONE predicate (EVN Bible, spöb MinStatus, gövt
 * Require, ränk 0x0200, and the mission-destination override)
 * ============================================================================
 *
 * Whether a stellar will let THIS player land, and — when it won't — WHY.
 * Quoted by the landing gate (planet_plugin's AttemptLandingSystem), the
 * radar's planet blip colour (iff_plugin's planetDisposition), the planet
 * comm dialog (hail_dialog_plugin), and the sim's planet-bribe handler
 * (hail_plugin's applyHail), so those four can never disagree about whether
 * a port is open — the same arrangement `landable` uses for "is it a port at
 * all" and `shipDisposition` uses for ship hostility.
 *
 * Pure and total over synced state (spöb data, the player's legal records,
 * the player's Contribute bits, their active ränks, the bribe map), with no
 * clock read and no randomness, so the display and the simulation reach the same verdict on
 * every peer.
 *
 * THE RULES, verbatim from the Bible:
 *
 *  - spöb **MinStatus** (~:2785): "The point on your record in the current
 *    system that you'll be denied landing clearance on this stellar."
 *      -32767         "Ignored (player can always land)"
 *      -1 to -32766   "You can be this evil before they shun you"
 *       0 to 32766    "They have to like you this much before they let you
 *                      land"
 *       32767         "Player can never land."
 *      "(Note that this field is ignored if the stellar is uninhabited)"
 *
 *    So the test is simply `record < minStatus` for every value in between,
 *    with the two sentinels short-circuiting it.
 *
 *  - gövt **Require** (~:1121): "These two Require fields together form a
 *    64-bit flag that is logically and'ed with the Contribute fields from the
 *    player's current ship and outfit items. If for each 1 bit in the Require
 *    fields there is not a matching 1 bit in one or more of the Contribute
 *    fields then you won't be allowed to visit any planets or stations owned
 *    by this govt - this is useful for making travel permits, for example."
 *    That is a SECOND, independent denial reason ('permit'), evaluated with
 *    the same mask arithmetic the shipyard and outfitter already use
 *    (shipyard_stock_rules' shipRequirementsMet).
 *
 *  - ränk **Flags 0x0200** (~:2260): "All planets of the affiliated
 *    government will let the player land when he has this rank, regardless of
 *    their MinStatus field." A THIRD input, and the one that makes the stock
 *    hypergate network a progression gate rather than a wall — see below.
 *
 *  - THE MISSION-DESTINATION OVERRIDE. A stellar an ACTIVE mission sends the
 *    player to lets them land no matter what: not the record, not a 32767
 *    "never", not a missing travel permit, not a rank they don't hold. A
 *    mission that could not be completed because its own destination refuses
 *    the pilot would be a dead end, and the original does not create those.
 *    The Bible does not spell this out as a field — it is a behaviour of the
 *    engine — so it is implemented here as the single most permissive rule,
 *    ahead of every denial reason.
 *
 *    ONLY ACTIVE missions count. An aborted or failed mission is removed from
 *    MissionsComponent outright (mission_logic.ts's abortMission/failMission),
 *    so "active" is simply "present in the map" and a dropped mission stops
 *    opening its destination on the very same tick.
 *
 *    BOTH LEGS count — travelPlanet and returnPlanet — for as long as the
 *    mission is active. The travel leg is not re-shut once travelDone is set:
 *    a player who has to go back (to re-take on cargo, or because the return
 *    leg routes through the same port) must not find the door closed behind
 *    them.
 *
 *    Duplicate stellars: landing on one copy of a stacked stellar satisfies an
 *    objective set to another (the Bible's TravelStel/ReturnStel rule), which
 *    mission_logic.ts implements through an injected `sameStellar`. That
 *    topology (name + containing-system coordinates) lives in the spaceport's
 *    MissionUniverse and is NOT reachable from the simulation, so
 *    `isMissionDestination` takes the same optional callback and falls back to
 *    an exact id match. In the sim that is what runs — a documented narrowing,
 *    and a conservative one: the worst case is that the override does not fire
 *    for a hidden duplicate, never that it fires when it should not.
 *
 * "YOUR RECORD IN THE CURRENT SYSTEM": the original keys legal records by
 * SYSTEM, seeded from the system owner's InitialRec. NovaJS keys them by
 * GOVERNMENT (reputation.ts's sanctioned simplification), so the record a
 * stellar judges you on is your record with the stellar's OWNING govt — which
 * for a stock system is the same number the original would have used, because
 * a stock system's stellars belong to the government that owns the system.
 * An INDEPENDENT stellar (spöb Govt -1, `govt: null`) has no government to
 * hold a record with and reads as 0.
 *
 * ONE EXEMPTION, from the data rather than from taste: UNINHABITED stellars
 * (spöb Flags 0x0020) — the Bible's own parenthesis. There is no traffic
 * control to deny you. (Every stock wormhole and every DEAD hypergate of the
 * collapsed network is uninhabited, so they pass here and are filtered, if at
 * all, by landable.ts.)
 *
 * THE HYPERGATE NETWORK IS SUPPOSED TO BE LOCKED. All 19 WORKING stock gates
 * — HG-V01 (nova:1400) through HG-Koria (nova:1418) — carry MinStatus 32767,
 * "Player can never land", and belong to gövt nova:183 "Hypergate" (whose
 * Require is 0, so no travel permit is involved). That 32767 is REAL: it says
 * the network is shut. What opens it is ränk nova:147 "Have Access to
 * Hypergate System" — affilGovt nova:183, flags 0x0208 (0x0200 land-anywhere
 * plus 0x0008 permanent) — granted by mïsn nova:898 "Deliver New Hypergate
 * Code;Sigma4" (OnAccept `k147 S899 S900`) at the end of the Sigma Shipyards
 * string, or by mïsn nova:608 "Steal Hypergate Codes;Rebel Sideline"
 * (OnSuccess `b149 k147`). A pilot without it is refused at every gate, and
 * the gate map never opens; a pilot with it is cleared at all 19.
 *
 * An EARLIER version of this module exempted any stellar with a `gate` from
 * MinStatus entirely, on the reading that "you never LAND on a gate". That was
 * a workaround for a feature: it handed every fresh pilot the whole network.
 *
 * RECORD-GATED PORTS DO EXIST in the stock data, which is what the 'hostile'
 * reason is for: the numbered Federation spacedocks (Spacedock I nova:184,
 * II nova:133, III nova:136, V nova:150, and Wild Geese Spacedock VI
 * nova:154) are MinStatus 2 — "They have to like you this much before they
 * let you land" — so a fresh pilot, whose Federation record starts at the
 * govt's InitialRec of 0, is refused there with 'hostile' until they earn it.
 *
 * NCB-gated landing denial (the mïsn/spöb bit tests behind some of the
 * original's refusals) remains the separate, unbuilt seam landable.ts names.
 */

/** MinStatus sentinel: "Ignored (player can always land)". */
export const MIN_STATUS_IGNORED = -32767;
/** MinStatus sentinel: "Player can never land." */
export const MIN_STATUS_NEVER = 32767;

/**
 * Why a stellar refuses landing clearance.
 *
 *  - 'forbidden': the port is shut to everyone (MinStatus 32767), or the
 *    player lacks the owning govt's travel permit ('permit' folds in here for
 *    colouring — see iff_plugin's planetDisposition). The original's word for
 *    this state is "Forbidden" (STR# 2002 index 172).
 *  - 'hostile': the player's legal record is below the stellar's MinStatus —
 *    they know you and they don't like you. The original's word is "Hostile"
 *    (STR# 2002 index 173).
 *  - 'permit': the gövt Require / Contribute travel-permit test failed.
 */
export type ClearanceDenial = 'forbidden' | 'hostile' | 'permit';

export type StellarClearance =
    | { cleared: true }
    | { cleared: false, reason: ClearanceDenial };

const CLEARED: StellarClearance = { cleared: true };

/** The static half of a clearance decision: what the spöb itself says. */
export interface ClearanceStellar {
    minStatus: number;
    flags: { uninhabited: boolean };
}

/** The player half: who they are to this stellar right now. */
export interface ClearancePlayer {
    /** The player's legal record with the stellar's owning govt. */
    record: number;
    /**
     * The owning gövt's 64-bit Require mask (GovtData.require, a DECIMAL
     * string — unlike shïp/oütf Contribute, which are hex). Undefined for an
     * independent stellar.
     */
    govtRequire?: string;
    /** Union of the player's ship + outfit Contribute bits. */
    contribute?: bigint;
    /** True while a paid bribe is buying this player clearance here. */
    bribed?: boolean;
    /**
     * True when an ACTIVE mission sends this player to this stellar (its
     * travel or return leg). Overrides every denial reason — see the module
     * comment. `isMissionDestination` computes it.
     */
    missionDestination?: boolean;
    /**
     * True when the player holds an active ränk affiliated with this
     * stellar's owning government carrying Flags 0x0200, "All planets of the
     * affiliated government will let the player land when he has this rank,
     * regardless of their MinStatus field".
     *
     * It neutralizes BOTH MinStatus outcomes — the 32767 "never" sentinel and
     * the record comparison — because both are the MinStatus field. It does
     * NOT cover the gövt Require travel permit, which the Bible describes as a
     * separate test on a separate field and which no rank flag mentions.
     * rank_logic.ts's `ranksAllowLanding` computes it.
     */
    rankLandingOverride?: boolean;
}

/**
 * The union of the Contribute flag sets of the player's current ship and every
 * outfit it carries — the left-hand side of the gövt Require test. The
 * spaceport has its own copy of this (shipyard_stock_rules' playerContribute)
 * built from a resolved id->contribute map; this one takes the raw values so
 * the SIMULATION can compute it from OutfitsStateComponent + cached outfit data
 * without importing the spaceport layer. shïp/oütf Contribute are hex strings.
 */
export function contributeBits(shipContribute: string | undefined,
    outfitContributes: Iterable<string | undefined>): bigint {
    let contribute = BigInt(shipContribute ?? '0x0');
    for (const value of outfitContributes) {
        contribute |= BigInt(value ?? '0x0');
    }
    return contribute;
}

/**
 * Whether the player's Contribute set covers a govt's Require mask. An empty
 * Require (0) always passes. Mirrors shipyard_stock_rules' shipRequirementsMet
 * but parses the govt's DECIMAL encoding — `BigInt` handles both forms, so the
 * only real difference is the default.
 */
export function govtRequirementsMet(require: string | undefined,
    contribute: bigint | undefined): boolean {
    const mask = BigInt(require ?? '0');
    return (mask & (contribute ?? 0n)) === mask;
}

/**
 * One active mission's resolved destinations — the part of
 * player_state_plugin's ActiveMission this module needs, taken structurally so
 * the clearance rules stay independent of the mission layer.
 */
export interface MissionDestinations {
    travelPlanet: string | null;
    returnPlanet: string | null;
}

/**
 * Whether any ACTIVE mission sends the player to `planetId` — the left-hand
 * side of the mission-destination override. `sameStellar` is the duplicate
 * stellar rule (mission_logic.ts's); without it, ids must match exactly.
 */
export function isMissionDestination(
    missions: Iterable<MissionDestinations> | undefined,
    planetId: string | undefined,
    sameStellar?: (a: string, b: string) => boolean): boolean {
    if (!missions || planetId === undefined) {
        return false;
    }
    const matches = (destId: string | null) => destId !== null
        && (destId === planetId || (sameStellar?.(destId, planetId) ?? false));
    for (const mission of missions) {
        if (matches(mission.travelPlanet) || matches(mission.returnPlanet)) {
            return true;
        }
    }
    return false;
}

/**
 * Whether `stellar` grants `player` landing clearance, and why not. See the
 * module comment for the rules and the two exemptions.
 *
 * Order matters only for WHICH reason a denied stellar reports (the landing
 * gate's message and the blip's colour): a shut port reads 'forbidden' before
 * anything else, a missing travel permit next, and the legal-record test last,
 * so a criminal at a permit-gated port is told about the permit.
 */
export function stellarClearance(stellar: ClearanceStellar,
    player: ClearancePlayer): StellarClearance {
    // A mission destination is open to the pilot the mission was given to,
    // whatever the port would otherwise say (see the module comment).
    if (player.missionDestination) {
        return CLEARED;
    }
    // A paid bribe buys clearance past EVERY denial reason for as long as it
    // lasts — the stock bribe lines are explicit that this is what the money
    // buys ("We'll let you slip by the security barrier if you pay us.",
    // "Pay us and we'll look the other way if you want to visit our
    // spaceport." — STR# 3002 indices 40 and 44).
    if (player.bribed) {
        return CLEARED;
    }
    // The Bible's own parenthesis: no traffic control, no clearance to deny.
    if (!isInhabited(stellar.flags)) {
        return CLEARED;
    }
    // ränk 0x0200 makes the whole MinStatus field read as "ignored"; the
    // permit test below still runs. Computed once so the two MinStatus
    // outcomes ('forbidden' and 'hostile') can't disagree about it.
    const minStatusOk = player.rankLandingOverride === true
        || stellar.minStatus === MIN_STATUS_IGNORED
        || (stellar.minStatus !== MIN_STATUS_NEVER
            && player.record >= stellar.minStatus);
    if (!minStatusOk && stellar.minStatus === MIN_STATUS_NEVER) {
        return { cleared: false, reason: 'forbidden' };
    }
    if (!govtRequirementsMet(player.govtRequire, player.contribute)) {
        return { cleared: false, reason: 'permit' };
    }
    if (!minStatusOk) {
        return { cleared: false, reason: 'hostile' };
    }
    return CLEARED;
}

/** Convenience: the denial reason, or undefined when cleared. */
export function clearanceDenial(clearance: StellarClearance):
    ClearanceDenial | undefined {
    return clearance.cleared ? undefined : clearance.reason;
}

/**
 * The player's legal record with a stellar's owning government — "your record
 * in the current system", under NovaJS's per-govt record model. Independent
 * stellars (no govt) read 0.
 */
export function stellarRecord(planetGovt: GovtData | undefined,
    records: LegalRecords | undefined): number {
    if (!planetGovt || !records) {
        return planetGovt?.initialRecord ?? 0;
    }
    return recordWith(records, planetGovt.id, planetGovt);
}

/**
 * The whole decision from the pieces every caller already has: the stellar's
 * parsed data, its government, the player's records, Contribute bits, and
 * bribe map. `bribedUntil` is the expiry read out of StellarBribesComponent
 * (planet_plugin) and `now` the simulation clock — a bribe whose expiry has
 * passed simply isn't applied, so no one has to prune the map.
 */
export function planetClearance(opts: {
    planet: Pick<PlanetData, 'minStatus' | 'flags'>,
    planetGovt?: GovtData,
    records?: LegalRecords,
    contribute?: bigint,
    bribedUntil?: number,
    now?: number,
    /** ränk 0x0200 for this stellar's govt; see ClearancePlayer. */
    rankLandingOverride?: boolean,
    /** An active mission sends the player here; see ClearancePlayer. */
    missionDestination?: boolean,
}): StellarClearance {
    const bribed = opts.bribedUntil !== undefined
        && opts.bribedUntil > (opts.now ?? 0);
    return stellarClearance(opts.planet, {
        record: stellarRecord(opts.planetGovt, opts.records),
        govtRequire: opts.planetGovt?.require,
        contribute: opts.contribute,
        bribed,
        rankLandingOverride: opts.rankLandingOverride,
        missionDestination: opts.missionDestination,
    });
}
