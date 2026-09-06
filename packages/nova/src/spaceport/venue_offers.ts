import { Entity } from 'nova_ecs/entity';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { LandedTransaction } from './landed_transaction.js';
import { OfferRolls, offerRollsForSystem, rollOffers } from './mission_offers.js';
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
 * ON THE LANDING'S TRANSACTION, under a savepoint of its own that is
 * released BEFORE the venue opens — so whatever an accept did (an OnAccept
 * `Gxxx`, the PickupMode 0 cargo, a takeCredits PayVal) is in the working
 * copy the venue reads, and on the entity, when it opens. Released in a
 * `finally` for the reason presentLandingPopups documents: an accept has
 * already landed in the working copy by the time the next popup's text is
 * expanded.
 *
 * `rolls` are the system visit's (OfferRolls), so walking in and out of
 * the outfitter does not reroll a 50% mission.
 */
export async function presentVenueOffersIn(transaction: LandedTransaction,
    popup: OfferPopup, location: number, rolls?: OfferRolls): Promise<void> {
    const { session, universe } = transaction;
    const visitRolls = rolls ?? offerRollsForSystem(
        universe.systemIdOfPlanet(transaction.planetId, session.state.bits));
    const offers = rollOffers(session, universe, location, visitRolls)
        .filter(offer => offer.acceptable);
    if (offers.length === 0) {
        return;
    }
    const visit = transaction.savepoint('venue offers');
    try {
        await presentOffers(popup, session, universe, offers);
    } finally {
        transaction.release(visit);
    }
}

/**
 * {@link presentVenueOffersIn} over a transaction of its own: the offers
 * are rolled against `entity` as it stands and an accept is on it when
 * this resolves. For a caller with no landing in progress (the specs);
 * the spaceport passes its landing's transaction.
 */
export async function presentVenueOffers(entity: Entity, popup: OfferPopup,
    universe: MissionUniverse, simulationData: SimulationGameDataInterface,
    planetId: string, location: number, rolls?: OfferRolls): Promise<void> {
    let transaction: LandedTransaction;
    try {
        transaction = await LandedTransaction.open(entity, simulationData,
            universe, planetId);
    } catch (e) {
        console.warn('Venue offer session failed to load:', e);
        return;
    }
    await presentVenueOffersIn(transaction, popup, location, rolls);
}
