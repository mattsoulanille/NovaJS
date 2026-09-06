import { MissionData } from 'novadatainterface/mission_data';
import { isInhabited, isPort } from '../core/index.js';
import { MissionContext } from './mission_context.js';
import { setStringPrefix } from './mission_ids.js';
import { resolveShipObjective } from './mission_ship_logic.js';
import { ShipObjective } from '../player/index.js';
import { matchesStellarRef, StellarInfo, stellarVisible } from './mission_stellar.js';
import { MAX_ACTIVE_MISSIONS } from '../player/index.js';

/**
 * Offer resolution: freezing a mïsn's random destination and cargo
 * choices into a concrete MissionOffer (as EV Nova does at offer time) and
 * re-checking whether it can be accepted. Split out of mission_logic.ts.
 */

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
