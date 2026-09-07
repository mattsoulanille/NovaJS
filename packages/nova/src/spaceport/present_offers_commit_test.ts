import 'jasmine';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
import { makeShip } from '../nova_plugin/ship/index.js';
import { MissionOffer } from '../nova_plugin/missions/index.js';
import { ControlBitsComponent } from '../nova_plugin/ncb/index.js';
import {
    CreditsComponent, GameDateComponent, MissionsComponent,
} from '../nova_plugin/player/index.js';
import { commitVenueCredits } from './credit_commit.js';
import { MissionSession } from './mission_session.js';
import { MissionUniverse } from './mission_universe.js';
import { OfferPopup, presentOffers } from './offer_popup.js';

/**
 * ============================================================================
 * The offer sequence's lost-commit seam
 * ============================================================================
 *
 * The main spaceport builds a MissionSession, runs presentOffers over it,
 * and commits — and it used to do that as two bare statements in a row:
 *
 *     await presentOffers(...);
 *     session.commit();
 *
 * presentOffers awaits a popup per offer, and an accept has ALREADY landed
 * in the session's working copy by the time the next offer's text is
 * expanded. So a throw anywhere further down that loop skipped the commit
 * entirely, and Spaceport.show's outer catch swallowed it: the player had
 * clicked Accept, watched the briefing, and owned no mission.
 *
 * These specs pin the two halves of the fix. First, that the mutation
 * really is in the working copy when presentOffers rejects — which is why
 * committing in a `finally` recovers the whole visit rather than half of
 * it. Second, that a rejection BEFORE any acceptance leaves the working
 * copy equal to the entity, so the same unconditional commit cannot invent
 * state out of a failed visit.
 */

/** A popup stand-in: `script` decides what each show() call does. */
function scriptedPopup(script: (call: number, text: string) =>
    'accept' | 'refuse' | Error): OfferPopup {
    let call = 0;
    return {
        async show(text: string) {
            const outcome = script(call++, text);
            if (outcome instanceof Error) {
                throw outcome;
            }
            return outcome;
        },
    } as unknown as OfferPopup;
}

describe('presentOffers and the session commit boundary', () => {
    /** A fresh default pilot docked at Earth, plus a live session. */
    async function bench() {
        const gameData = await getIntegrationGameData();
        const universe = MissionUniverse.shared(gameData);
        await universe.load();
        const start = await gameData.data.PlayerStart.get('nova:128');
        const shipData = await gameData.data.Ship.get(start.ship);
        const entity = makeShip(shipData);
        entity.components.set(GameDateComponent, { ...start.date });
        entity.components.set(CreditsComponent, { credits: start.credits });
        entity.components.set(ControlBitsComponent, new Set());
        const session = await MissionSession.create(
            entity, gameData, universe, 'nova:128');
        // Two real missions the pilot can be offered, taken as frozen
        // offers so the spec does not depend on a board roll.
        const offers: MissionOffer[] = ['nova:211', 'nova:418'].map(id => ({
            data: universe.getMission(id)!,
            travelPlanet: 'nova:214', returnPlanet: null,
            cargoType: 0, cargoQty: 2, acceptable: true,
        }));
        return { entity, universe, session, offers };
    }

    it('keeps an accept made before a later throw, so committing in a '
        + 'finally recovers it', async () => {
            const { entity, universe, session, offers } = await bench();
            // Accept the first offer, then blow up presenting the second.
            // (Neither of these missions has a BriefText, so the second
            // show() is the second offer's own text.)
            const popup = scriptedPopup(call => call === 0 ? 'accept'
                : new Error('the popup exploded'));

            await expectAsync(presentOffers(popup, session, universe, offers))
                .toBeRejected();

            // The accept is in the WORKING COPY, and only the first one
            // got that far...
            expect(session.state.missions.has('nova:211')).toBeTrue();
            expect(session.state.missions.has('nova:418')).toBeFalse();
            // ...but not yet on the entity: skipping the commit (what the
            // old `await …; session.commit();` did on a throw) is what
            // lost it.
            expect(entity.components.get(MissionsComponent)?.has('nova:211'))
                .toBeFalsy();

            // The `finally` commit is what the spaceport now runs.
            session.commit();
            expect(entity.components.get(MissionsComponent)!.has('nova:211'))
                .toBeTrue();
        });

    it('commits nothing when the throw comes before any acceptance',
        async () => {
            const { entity, universe, session, offers } = await bench();
            const creditsBefore =
                entity.components.get(CreditsComponent)!.credits;
            const dateBefore = { ...entity.components.get(GameDateComponent)! };
            const popup = scriptedPopup(() => new Error('failed at once'));

            await expectAsync(presentOffers(popup, session, universe, offers))
                .toBeRejected();
            session.commit();

            expect(entity.components.get(MissionsComponent)!.size).toBe(0);
            expect(entity.components.get(CreditsComponent)!.credits)
                .toBe(creditsBefore);
            expect(entity.components.get(GameDateComponent))
                .toEqual(dateBefore);
        });

    /**
     * The other half of that `finally`: it must commit a DELTA, not the
     * absolute balance the session was seeded with. The offer popups await
     * the player for as long as they care to read, and a writer outside
     * the session (the refuel button; the escort settlement of a Leave
     * pressed under a blind popup) can move the LIVE CreditsComponent
     * meanwhile — so a payment that lands while an offer is on screen was
     * erased by the session's absolute write-back the moment the player
     * dismissed it. See spaceport/credit_commit.ts.
     */
    it('keeps an escort sale that settles while an offer popup is open',
        async () => {
            const { entity, universe, session, offers } = await bench();
            const baseline = session.state.credits.credits;
            const SALE = 40000;

            // Accept the first offer; while the SECOND offer is on screen,
            // an escort touches down and its deal settles against the live
            // component — exactly what the docked frame loop does.
            const popup = scriptedPopup(call => {
                if (call === 0) {
                    return 'accept';
                }
                const live =
                    entity.components.get(CreditsComponent)!.credits;
                entity.components.set(CreditsComponent,
                    { credits: live + SALE });
                return 'refuse';
            });
            await presentOffers(popup, session, universe, offers);

            // The session never saw the sale: its working copy still holds
            // whatever the visit itself spent or earned.
            const working = session.state.credits.credits;
            expect(entity.components.get(CreditsComponent)!.credits)
                .toBe(baseline + SALE);

            // The spaceport's commit, as it now runs.
            commitVenueCredits(entity, baseline, () => session.commit());

            // BOTH survive: the sale, and the visit's own delta.
            expect(entity.components.get(CreditsComponent)!.credits)
                .toBe(working + SALE);
            expect(entity.components.get(MissionsComponent)!.has('nova:211'))
                .toBeTrue();
            // An absolute write-back would have stored the working balance
            // alone; pin that this spec can tell the two apart.
            expect(working + SALE).not.toBe(working);
        });
});
