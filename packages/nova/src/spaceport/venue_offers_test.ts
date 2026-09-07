import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
import { CargoComponent, makeShip, OutfitsStateComponent } from '../nova_plugin/ship/index.js';
import {
    LOCATION_OUTFIT, LOCATION_SHIPYARD, LOCATION_TRADING,
    missionCargoKey,
} from '../nova_plugin/missions/index.js';
import { ActiveRanksComponent, ControlBitsComponent }
    from '../nova_plugin/ncb/index.js';
import {
    CreditsComponent, GameDateComponent, MissionsComponent,
} from '../nova_plugin/player/index.js';
import {
    CombatRatingComponent, LegalRecordsComponent,
} from '../nova_plugin/reputation/index.js';
import { OfferRolls, rollOffers } from './mission_offers.js';
import { MissionSession } from './mission_session.js';
import { MissionUniverse } from './mission_universe.js';
import { OfferPopup } from './offer_popup.js';
import { presentVenueOffers } from './venue_offers.js';

/**
 * ============================================================================
 * Missions offered by the trade center, the shipyard and the outfitter
 * ============================================================================
 *
 * mïsn AvailLoc 4/5/6. Nothing rolled these three locations, so stock's
 * Federation, Gli-tech and Sigma Shipyards strings never began. Pinned
 * against the real data at Earth (a Federation stellar with all three
 * venues): nova:428 "Federation Resupply;Fed1" at the outfitter, nova:555
 * "Sigma Shipyards Delivery;Sigma1" at the shipyard, nova:630 "Trade
 * between Earth and Port Kane;Tutorial 002" at the trade center.
 */

/** shïp nova:138 "Argosy": 50 tons of hold (nova:428 carries 20). */
const ARGOSY = 'nova:138';
const EARTH = 'nova:128';

/**
 * A pilot that qualifies for all three: nova:428 wants AvailRating 150,
 * AvailRecord 2 with the Federation, none of b50/b511/b515/b6666 and room
 * for 20 tons; nova:555 wants AvailRating 10 and none of b33/b149/b424/
 * b6300/b6302; nova:630 wants b9200 (which also silences Tutorial 001's
 * landing offer, `!(b9200 | b9215)`).
 */
async function pilot(): Promise<Entity> {
    const gameData = await getIntegrationGameData();
    const start = await gameData.data.PlayerStart.get('nova:128');
    const entity = makeShip(await gameData.data.Ship.get(ARGOSY));
    entity.components.set(GameDateComponent, { ...start.date });
    entity.components.set(CreditsComponent, { credits: start.credits });
    entity.components.set(ControlBitsComponent, new Set([9200]));
    entity.components.set(ActiveRanksComponent, new Set());
    entity.components.set(MissionsComponent, new Map());
    entity.components.set(CargoComponent, new Map());
    entity.components.set(OutfitsStateComponent, new Map());
    entity.components.set(CombatRatingComponent, { kills: 150 });
    entity.components.set(LegalRecordsComponent, new Map([[EARTH, 5]]));
    return entity;
}

async function universeFor() {
    const gameData = await getIntegrationGameData();
    const universe = MissionUniverse.shared(gameData);
    await universe.load();
    return { gameData, universe };
}

/** Every AvailRandom roll wins. */
const ALWAYS: OfferRolls = new Map();
function winningRolls(universe: MissionUniverse): OfferRolls {
    for (const mission of universe.missions) {
        ALWAYS.set(mission.id, 0);
    }
    return ALWAYS;
}

/** A popup stand-in that records what it showed and answers by text. */
function scriptedPopup(answer: (text: string, hasRefuse: boolean) =>
    'accept' | 'refuse') {
    const shown: string[] = [];
    const popup = {
        async show(text: string, buttons: { refuse?: string | null }) {
            shown.push(text);
            return answer(text, Boolean(buttons.refuse));
        },
    } as unknown as OfferPopup;
    return { popup, shown };
}

describe('venue mission offers (AvailLoc 4/5/6)', () => {
    it('rolls the outfitter, shipyard and trade-center missions at their '
        + 'own locations', async () => {
            const { gameData, universe } = await universeFor();
            const session = await MissionSession.create(await pilot(),
                gameData, universe, EARTH);
            const rolls = winningRolls(universe);
            const ids = (location: number) => rollOffers(session, universe,
                location, rolls).map(o => o.data.id);
            expect(ids(LOCATION_OUTFIT)).toContain('nova:428');
            expect(ids(LOCATION_SHIPYARD)).toContain('nova:555');
            expect(ids(LOCATION_TRADING)).toContain('nova:630');
            // The locations are disjoint.
            expect(ids(LOCATION_OUTFIT)).not.toContain('nova:555');
            expect(ids(LOCATION_SHIPYARD)).not.toContain('nova:428');
        });

    it('presents the outfitter\'s offer and commits an accept to the '
        + 'entity before the venue opens (nova:428)', async () => {
            const { gameData, universe } = await universeFor();
            const entity = await pilot();
            const { popup, shown } = scriptedPopup((text, hasRefuse) =>
                text.startsWith('As you wander around the outfitting area')
                    || !hasRefuse ? 'accept' : 'refuse');
            await presentVenueOffers(entity, popup, universe, gameData,
                EARTH, LOCATION_OUTFIT, winningRolls(universe));
            expect(shown.some(text =>
                text.startsWith('As you wander around the outfitting area')))
                .toBeTrue();
            // The briefing followed the accept.
            expect(shown.some(text =>
                text.startsWith('The Federation official sits down')))
                .toBeTrue();
            // Committed: the mission is active and its 20 tons of IR
            // missiles (PickupMode 0) are aboard, ready for the outfitter
            // to build its working copy from.
            const active = entity.components.get(MissionsComponent)!
                .get('nova:428');
            expect(active).toBeDefined();
            expect(active!.cargoLoaded).toBeTrue();
            expect(entity.components.get(CargoComponent)!
                .get(missionCargoKey('nova:428'))).toBe(20);
            expect(entity.components.get(ControlBitsComponent)!.has(511))
                .toBeTrue();
        });

    it('runs OnRefuse and commits that too', async () => {
        const { gameData, universe } = await universeFor();
        const entity = await pilot();
        const { popup } = scriptedPopup((_text, hasRefuse) =>
            hasRefuse ? 'refuse' : 'accept');
        await presentVenueOffers(entity, popup, universe, gameData,
            EARTH, LOCATION_OUTFIT, winningRolls(universe));
        // nova:428's OnRefuse is "b6666", which also takes it off the
        // table for good.
        expect(entity.components.get(MissionsComponent)!.has('nova:428'))
            .toBeFalse();
        expect(entity.components.get(ControlBitsComponent)!.has(6666))
            .toBeTrue();
    });

    it('is silent when nothing rolls', async () => {
        const { gameData, universe } = await universeFor();
        const entity = await pilot();
        // Every roll misses.
        const losing: OfferRolls = new Map();
        for (const mission of universe.missions) {
            losing.set(mission.id, 99.9);
        }
        const { popup, shown } = scriptedPopup(() => 'accept');
        await presentVenueOffers(entity, popup, universe, gameData,
            EARTH, LOCATION_OUTFIT, losing);
        expect(shown.length).toBe(0);
        expect(entity.components.get(MissionsComponent)!.size).toBe(0);
    });
});
