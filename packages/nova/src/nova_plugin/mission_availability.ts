import { MissionData } from 'novadatainterface/mission_data';
import { AUTO_ABORT_FUEL_COST } from './mission_auto_abort.js';
import { MissionContext } from './mission_context.js';
import {
    ownsOutfit, sameNumberedResource, setStringPrefix,
    systemDiscoveryOperators,
} from './mission_ids.js';
import { shipGoalOfferable } from './mission_ship_logic.js';
import {
    matchesStellarRef, stellarAdjacencyOf, stellarRecord,
} from './mission_stellar.js';
import { evaluateNCBTest, NCBParseError } from './ncb.js';
import {
    AVAIL_RECORD_DOMINATED_ANY,
    AVAIL_RECORD_DOMINATED_HERE,
    availRatingOk,
    availRecordOk,
} from './reputation.js';

/**
 * The offer gates: whether a mïsn is available at a stellar/location for
 * this player (AvailLoc, AvailStel, AvailRecord, AvailRating, Require,
 * AvailShipType, the inherentAI flags, the fuel gate and AvailBits) —
 * everything but the AvailRandom roll. Split out of mission_logic.ts.
 */

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
