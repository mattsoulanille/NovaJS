import { dateFromDayNumber, formatDate } from '../nova_plugin/player/calendar.js';
import {
    cargoName,
    makeMissionOffer,
    MissionOffer,
    missionMatchesLocation,
} from '../nova_plugin/missions/mission_logic.js';
import { ActiveMission } from '../nova_plugin/player/player_state_plugin.js';
import { MissionSession } from './mission_session.js';
import { MissionUniverse } from './mission_universe.js';

/**
 * Offer plumbing shared by the mission BBS, the bar, the main spaceport
 * and the trade/shipyard/outfitter venues: rolling the visit's offers and
 * building the wildcard substitution table for expandMissionText.
 */

/**
 * The AvailRandom rolls of one SYSTEM VISIT: mission id -> a uniform
 * number in [0, 100), compared against the mïsn's AvailRandom percentage.
 *
 * EVN Bible, AvailRandom: "Mission randomizing values are recalculated
 * each time you warp into a system." So a 40% mission is either on offer
 * for the whole visit or not at all — every landing in the system, every
 * opening of the BBS, every walk into the bar sees the same answer. The
 * rolls used to be made afresh on every board opening, which let a
 * player close and reopen the BBS until a 10% mission appeared.
 *
 * Player-local UI randomness (like the outfitter's R(a b) rolls), so
 * plain Math.random fills it — only accepted-mission state ever reaches
 * the simulation. A plain Map so a spec can pre-seed a roll.
 */
export type OfferRolls = Map<string, number>;

/** The one visit's rolls this client holds (see offerRollsForSystem). */
let visitRolls: { systemId: string | undefined, rolls: OfferRolls } = {
    systemId: undefined, rolls: new Map(),
};

/**
 * The rolls for the visit to `systemId`, started afresh when the system
 * differs from the last one asked about.
 *
 * KNOWN GAP: a jump out and straight back in — landing nowhere in
 * between — keeps the previous visit's rolls, because the spaceport is
 * the only caller and nothing here sees the intervening system entry.
 * {@link resetOfferRolls} is the hook a system-entry path can call to
 * close it; the spaceport-side cache is the faithful answer for every
 * other sequence (several landings in one system share their rolls, as
 * the original's do).
 */
export function offerRollsForSystem(systemId: string | undefined): OfferRolls {
    if (systemId !== visitRolls.systemId) {
        visitRolls = { systemId, rolls: new Map() };
    }
    return visitRolls.rolls;
}

/** Forgets the current visit's rolls (a new system entry; specs). */
export function resetOfferRolls(): void {
    visitRolls = { systemId: undefined, rolls: new Map() };
}

/**
 * Rolls availability and freezes the offers, sorted by display weight.
 *
 * With `rolls` (the visit's — see OfferRolls) each mission's AvailRandom
 * roll is made once and reused for the rest of the system visit; without
 * it every call rolls afresh, which is what the in-flight përs offer
 * wants (ship_mission_accept.ts: the original re-offers a refused
 * mission on the next hail) and what the older specs exercise.
 */
export function rollOffers(session: MissionSession,
    universe: MissionUniverse, location: number,
    rolls?: OfferRolls, random: () => number = Math.random): MissionOffer[] {
    const ctx = session.machinery.offerContext();
    const offers: MissionOffer[] = [];
    for (const mission of universe.missions) {
        if (!missionMatchesLocation(mission, location, ctx)) {
            continue;
        }
        if (mission.availRandom < 100) {
            let roll = rolls?.get(mission.id);
            if (roll === undefined) {
                roll = random() * 100;
                rolls?.set(mission.id, roll);
            }
            if (roll >= mission.availRandom) {
                continue;
            }
        }
        const offer = makeMissionOffer(mission, ctx);
        if (offer) {
            offers.push(offer);
        }
    }
    offers.sort((a, b) => b.data.dispWeight - a.data.dispWeight);
    return offers;
}

/**
 * The <DST>/<RET>/... substitution table for one offer. `currentDay`
 * is the player's day number, used only to derive an offer's deadline
 * when the (not-yet-active) offer has a time limit; an already-active
 * mission carries its own resolved deadlineDay, so this dialog works in
 * flight (no MissionSession) as well as docked.
 */
export function offerSubstitutions(universe: MissionUniverse,
    currentDay: number, offer: MissionOffer,
    active?: ActiveMission) {
    const travel = active?.travelPlanet ?? offer.travelPlanet;
    const ret = active?.returnPlanet ?? offer.returnPlanet;
    const deadlineDay = active?.deadlineDay
        ?? (offer.data.timeLimit > 0
            ? currentDay + offer.data.timeLimit : null);
    return {
        destinationStellar: universe.planetName(travel ?? ret),
        destinationSystem: universe.systemNameOfPlanet(travel ?? ret),
        returnStellar: universe.planetName(ret),
        returnSystem: universe.systemNameOfPlanet(ret),
        cargoType: offer.cargoType >= 0
            ? cargoName(offer.cargoType, universe.cargoNames) : undefined,
        cargoQty: offer.cargoQty > 0 ? offer.cargoQty : undefined,
        deadline: deadlineDay !== null
            ? formatDate(dateFromDayNumber(deadlineDay)) : undefined,
        payment: offer.data.payVal > 0 ? offer.data.payVal : undefined,
        // <SN>: only an ACCEPTED mission has a special ship name (the
        // pick happens at accept — EVN Bible). A bare offer leaves it
        // undefined, which expandMissionText renders as its generic
        // fallback.
        specialShipName: active?.shipName,
    };
}

/** A pseudo-offer view of an already-active mission, for display. */
export function activeAsOffer(universe: MissionUniverse,
    active: ActiveMission): MissionOffer | undefined {
    const mission = universe.getMission(active.id);
    if (!mission) {
        return undefined;
    }
    return {
        data: mission,
        travelPlanet: active.travelPlanet,
        returnPlanet: active.returnPlanet,
        cargoType: active.cargoType,
        cargoQty: active.cargoQty,
        acceptable: true,
    };
}
