import { Entity } from 'nova_ecs/entity';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { LandedTransaction } from './landed_transaction.js';
import { landingOffers, OfferRolls } from './mission_offers.js';
import { MissionUniverse } from './mission_universe.js';
import { OfferPopup, presentOffers } from './offer_popup.js';

/**
 * The mission offers a VENUE makes as the player walks in — the trade
 * center (mïsn AvailLoc 4), the shipyard (5) and the outfitter (6) —
 * presented as popups exactly as the bar presents its AvailLoc 1 offers
 * on entry and the spaceport its AvailLoc 3 offers on landing.
 *
 * Until this existed nothing rolled those three locations, so every
 * mission authored for them could only ever start through an `Sxxx`:
 * stock's Federation string (nova:428 "Federation Resupply;Fed1" and
 * 429-433 at the outfitter), the Gli-tech string (549, 551-554), the
 * Sigma Shipyards string (555, 897, 898 — the rank that opens the
 * hypergate network), the only exit from Pirate 008 (709), United
 * Shipping 5 (577) and Tutorials 002-005/007 never began.
 *
 * ON THE LANDING'S TRANSACTION, under a savepoint of its own, released
 * when the last popup is answered — so whatever an accept did (an
 * OnAccept `Gxxx`, the PickupMode 0 cargo, a takeCredits PayVal) is in
 * the working copy, and on the entity once the enclosing visit is
 * released. The spaceport puts these up OVER the venue, once its screen
 * has been drawn (Spaceport.openVenue: Matthew's 2026-11-26 playtest
 * ruling, "shipyard mission offer should appear after the shipyard screen
 * renders"), and then reopens the venue on what the answers left, so the
 * venue's view is the one an entry after the offers would have built.
 * Released in a `finally` for the reason presentLandingPopups documents:
 * an accept has already landed in the working copy by the time the next
 * popup's text is expanded.
 *
 * `rolls` are the system visit's (OfferRolls), so walking in and out of
 * the outfitter does not reroll a 50% mission; the SET of offers is the
 * system visit's, rolled at the touch-down (landingOffers, #324), so an
 * accept anywhere in the visit can withdraw a venue offer but never add
 * one before the next system entry: a shipyard or outfitter first opened
 * after such an accept offers nothing (reference "#324 wave 22").
 *
 * `whenReady`, awaited only when there IS something to offer (so a venue
 * with nothing to offer waits on nothing), is where the caller holds the
 * first popup back until its screen is up; resolving false withdraws the
 * whole sequence (the venue was left or torn down meanwhile). Resolves
 * true when the offers were put to the player (the working copy may
 * then have moved) and false when nothing was.
 */
export async function presentVenueOffersIn(transaction: LandedTransaction,
    popup: OfferPopup, location: number, rolls?: OfferRolls,
    whenReady?: () => Promise<boolean>): Promise<boolean> {
    const { session, universe } = transaction;
    const visitRolls = rolls ?? transaction.offerRolls;
    const offers = landingOffers(transaction.offerSets, session, universe,
        location, visitRolls).filter(offer => offer.acceptable);
    if (offers.length === 0) {
        return false;
    }
    if (whenReady && !await whenReady()) {
        return false;
    }
    const visit = transaction.savepoint('venue offers');
    try {
        await presentOffers(popup, session, universe, offers, visitRolls);
    } finally {
        transaction.release(visit);
    }
    return true;
}

/**
 * {@link presentVenueOffersIn} over a transaction of its own: the offers
 * are rolled against `entity` as it stands and an accept is on it when
 * this resolves. For a caller with no landing in progress (the specs);
 * the spaceport passes its landing's transaction.
 */
export async function presentVenueOffers(entity: Entity, popup: OfferPopup,
    universe: MissionUniverse, simulationData: SimulationGameDataInterface,
    planetId: string, location: number, rolls?: OfferRolls): Promise<boolean> {
    let transaction: LandedTransaction;
    try {
        transaction = await LandedTransaction.open(entity, simulationData,
            universe, planetId);
    } catch (e) {
        console.warn('Venue offer session failed to load:', e);
        return false;
    }
    return presentVenueOffersIn(transaction, popup, location, rolls);
}
