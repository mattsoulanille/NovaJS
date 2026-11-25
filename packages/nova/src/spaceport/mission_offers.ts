import { dateFromDayNumber, formatDate, ActiveMission } from '../nova_plugin/player/index.js';
import {
    acceptOffer,
    AcceptResult,
    checkAcceptable,
    missionCargoName,
    makeMissionOffer,
    MissionOffer,
    missionMatchesLocation,
    offerAutoAccepts,
} from '../nova_plugin/missions/index.js';
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
 * The missions AUTO-ACCEPTED (offerAutoAccepts: no offer text) during a
 * system visit, keyed by that visit's {@link OfferRolls} so they share its
 * lifetime: a new system visit is a new rolls map, and a fresh record.
 *
 * THE AUTO-ACCEPT LOOP GUARD (#319). A clicked offer is re-shown every
 * time the player walks back into the bar, and that is harmless — the
 * player decides each time. An auto-accept decides for them, so a
 * text-less mission whose availability survives its own accept would
 * otherwise be taken again on every walk-in, every landing in the system,
 * every reopening of the BBS. Most of the data guards itself: ARPIA's
 * "Death" (arpia:1123) stays ACTIVE once taken, and an active mission is
 * never offered; its Pirate-Strike twin arpia:1124 clears its own b2015
 * in OnAccept. What is left — an auto-ABORT mission (it never becomes
 * active) whose AvailBits it leaves true — is taken at most once per
 * system visit: the same scope the Bible gives AvailRandom ("Mission
 * randomizing values are recalculated each time you warp into a system"),
 * so a mission that is on offer for the visit is taken once for it.
 */
const autoAcceptedByVisit = new WeakMap<OfferRolls, Set<string>>();

/** Whether `missionId` was auto-accepted already in the `rolls` visit. */
export function autoAcceptedThisVisit(rolls: OfferRolls | undefined,
    missionId: string): boolean {
    return rolls !== undefined
        && (autoAcceptedByVisit.get(rolls)?.has(missionId) ?? false);
}

/**
 * Takes a text-less offer on unasked (offerAutoAccepts), through the ONE
 * accept path a clicked Accept takes — acceptOffer, so OnAccept, the
 * start-time PayVal, PickupMode 0 cargo, an immediate auto-abort's
 * OnAbort/Pay and its special ships all run exactly as they would for a
 * click — and records it against the visit's rolls (see
 * autoAcceptedByVisit). A refused accept (a full hold, the 16-mission
 * cap) is not recorded, so the next opportunity tries again, as a
 * clicked offer would be shown again.
 */
export function autoAcceptOffer(session: MissionSession, offer: MissionOffer,
    rolls?: OfferRolls): AcceptResult {
    const result = acceptOffer(session.machinery, offer, session.outfits);
    if (result.accepted && rolls) {
        let accepted = autoAcceptedByVisit.get(rolls);
        if (!accepted) {
            accepted = new Set();
            autoAcceptedByVisit.set(rolls, accepted);
        }
        accepted.add(offer.data.id);
    }
    return result;
}

/**
 * Auto-accepts every acceptable text-less offer in `offers`, in order
 * (see autoAcceptOffer), and returns the offers that remain to be ASKED —
 * the ones with offer text. The text-less ones are never left to ask:
 * there is nothing to show. For the BBS, which lists its offers rather
 * than asking them one popup at a time; the popup sites go through
 * presentOffers, which interleaves the same accept with its popups.
 */
export function autoAcceptOffers(session: MissionSession,
    offers: readonly MissionOffer[], rolls?: OfferRolls): {
        accepted: MissionOffer[], remaining: MissionOffer[],
    } {
    const accepted: MissionOffer[] = [];
    const remaining: MissionOffer[] = [];
    for (const offer of offers) {
        if (!offerAutoAccepts(offer.data)) {
            remaining.push(offer);
            continue;
        }
        // An earlier accept's set string may have started it (Sxxx), or
        // falsified its availability (two mutually exclusive missions,
        // #324): re-asked against the working copy (stillOffered).
        if (!offer.acceptable || !stillOffered(session, offer)) {
            continue;
        }
        if (autoAcceptOffer(session, offer, rolls).accepted) {
            accepted.push(offer);
        }
    }
    return { accepted, remaining };
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
        // Already taken on unasked this visit (the auto-accept loop
        // guard, autoAcceptedByVisit).
        if (autoAcceptedThisVisit(rolls, mission.id)) {
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
 * One LANDING's offers, frozen per location (mïsn AvailLoc -> the offers
 * rolled for it). Kept on the landing's transaction
 * (LandedTransaction.offerSets), so it lives exactly as long as the
 * landing: no venue savepoint snapshots it (a rollback does not unroll
 * it) and a hull swap keeps it.
 */
export type LandingOffers = Map<number, MissionOffer[]>;

/**
 * The offers at `location` for this landing (#324).
 *
 * THE SET IS ROLLED ONCE PER LANDING, PER LOCATION, and never grows in the
 * landing. The original adds nothing in the visit (reference "#324 mission
 * BBS after an accept, wave 21", finding 2): a BBS job, a bar offer and a
 * trade-center offer that an accept made available were not offered on
 * reopening the BBS or walking back into the bar or the trade center —
 * only from the next landing on. They used to be rolled afresh on every
 * open, so a reopened board listed what the last accept unlocked.
 *
 * Rolled at the FIRST open of the location in the landing, not at the
 * touch-down. GUESS: the reference run entered the bar and the trade
 * center before the accept, so either rule fits it; a first open after an
 * in-visit accept was not measured. The lazy rule never hides an offer
 * that a landing popup's accept unlocked from a venue the player had not
 * opened yet.
 *
 * WITHDRAWALS STAY LIVE: every read re-filters the frozen set against the
 * working copy (stillOffered), so an accept anywhere in the landing — the
 * BBS, the bar, a popup — withdraws what no longer qualifies (finding 1).
 * GUESS for a plain reopen: the original was seen to re-check only on an
 * ACCEPT (a reopened board after an `i` abort still listed a job the
 * abort's record change had disqualified, until the next accept withdrew
 * it). Re-filtering on every read is the one consistent rule here, and it
 * also keeps a job at the BBS from staying takeable after a bar accept
 * falsified its gate (the mutually exclusive pair across two locations).
 *
 * An offer this visit auto-accepted (autoAcceptedThisVisit) is dropped
 * too, so the #319 loop guard holds over the frozen set, and every offer
 * comes back with its `acceptable` flag re-judged (checkAcceptable: the
 * hold and the mission cap as they stand now) — a gate on TAKING an offer,
 * not on offering it. The frozen choices (destinations, cargo, the
 * AvailRandom answer) are untouched.
 */
export function landingOffers(landing: LandingOffers,
    session: MissionSession, universe: MissionUniverse, location: number,
    rolls?: OfferRolls): MissionOffer[] {
    let frozen = landing.get(location);
    if (!frozen) {
        frozen = rollOffers(session, universe, location, rolls);
        landing.set(location, frozen);
    }
    const ctx = session.machinery.offerContext();
    return frozen
        .filter(offer => !autoAcceptedThisVisit(rolls, offer.data.id)
            && stillOffered(session, offer))
        .map(offer => {
            const check = checkAcceptable(offer, ctx);
            return check.acceptable
                ? { ...offer, acceptable: true, reason: undefined }
                : { ...offer, acceptable: false, reason: check.reason };
        });
}

/**
 * Whether an offer rolled earlier in this visit is STILL on offer: its
 * mïsn's availability (AvailBits, AvailRecord, AvailRating, "not already
 * active", ...) judged again against the session's working copy as it
 * stands NOW. The offers are frozen when they are rolled — destinations,
 * cargo and the AvailRandom answer must not change while the player looks
 * at them — but an accept or a refuse in the same visit can change what
 * the player qualifies for: a plug-in's two mutually exclusive missions
 * (each `!bX` in its AvailBits, `bX` in its OnAccept) must not both be
 * acceptable in one sitting (#324's ruling). The AvailRandom roll and the
 * frozen choices are untouched; only the gates are re-asked.
 */
export function stillOffered(session: MissionSession,
    offer: MissionOffer): boolean {
    return missionMatchesLocation(offer.data, offer.data.availLoc,
        session.machinery.offerContext());
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
    /** The player's control bits: <DSY>/<RSY> name the copy of a stacked
     * system that is active for THEM (#325). */
    bits: ReadonlySet<number>,
    active?: ActiveMission) {
    const travel = active?.travelPlanet ?? offer.travelPlanet;
    const ret = active?.returnPlanet ?? offer.returnPlanet;
    const deadlineDay = active?.deadlineDay
        ?? (offer.data.timeLimit > 0
            ? currentDay + offer.data.timeLimit : null);
    return {
        destinationStellar: universe.planetName(travel ?? ret),
        destinationSystem: universe.systemNameOfPlanet(travel ?? ret, bits),
        returnStellar: universe.planetName(ret),
        returnSystem: universe.systemNameOfPlanet(ret, bits),
        // <CT>: the running-text (STR# 4001) name, '*' dropped ("1 ton
        // of artwork" in the stock Un. Shipping Delivery briefing).
        cargoType: offer.cargoType >= 0
            ? missionCargoName(offer.cargoType, universe.cargoNames,
                universe.cargoNamesLower).lower : undefined,
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
