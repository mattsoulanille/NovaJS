import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { BITS, SYNTHETIC } from 'novaparse/synthetic/universe';
import {
    getIntegrationGameData, getSyntheticGameData,
} from '../communication/simulation_test_fixture.js';
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
 * mïsn AvailLoc 4/5/6. Nothing rolled these three locations, so a mission
 * authored for a venue could only ever begin through an `Sxxx` (stock's
 * Federation, Gli-tech and Sigma Shipyards strings among them). Pinned
 * here against the synthetic scenario at Port Amberline, which has all
 * three venues and one job at each: the Trade Errand (AvailLoc 4, 20
 * tons of equipment for Coldharbour, PickupMode 0, OnAccept b103, OnRefuse
 * b104, AvailBits `!b103 & !b104`), the Shipyard Errand (AvailLoc 5) and
 * the Outfitter Errand (AvailLoc 6). The Bible's AvailLoc numbering is
 * "4 In the trading dialog, 5 In the shipyard dialog, 6 In the outfit
 * dialog" (p. 1257); the locations below are the AvailLoc each mission
 * carries.
 */

/** shïp "Heron Warden": 60 tons of hold (the AvailLoc 4 job carries 20). */
const WARDEN = SYNTHETIC.ships.warden;
const PORT = SYNTHETIC.planets.port;

/** "Trade Errand", AvailLoc 4 — offered in the TRADING dialog. */
const TRADING_JOB = SYNTHETIC.missions.tradeErrand;
/** "Shipyard Errand", AvailLoc 5. */
const SHIPYARD_JOB = SYNTHETIC.missions.shipyardErrand;
/** "Outfitter Errand", AvailLoc 6 — offered in the OUTFIT dialog. */
const OUTFIT_JOB = SYNTHETIC.missions.outfitterErrand;

/** The first words of each job's offer text (dësc 4000 + n). */
const TRADING_OFFER = 'A trader on the exchange floor has twenty tons of equipment';
const SHIPYARD_OFFER = 'The shipwright wants a hull scan';
const OUTFIT_OFFER = 'The outfitter will pay well for five tons of luxuries';
/** The AvailLoc 6 job's briefing, shown after the accept. */
const OUTFIT_BRIEF = 'Take five tons of luxuries to Halden Refuge';

/**
 * A pilot that qualifies for all three. The two ungated jobs need only
 * the room (20 tons); the AvailLoc 6 job is the gated one — AvailBits
 * `b105` and AvailRating 10 — so the pilot carries b105 and ten kills.
 * The Meridian legal record is there because a venue job may ask for one
 * (these three ask for AvailRecord 0).
 */
async function pilot(): Promise<Entity> {
    const gameData = await getSyntheticGameData();
    const start = await gameData.data.PlayerStart.get(SYNTHETIC.playerStart);
    const entity = makeShip(await gameData.data.Ship.get(WARDEN));
    entity.components.set(GameDateComponent, { ...start.date });
    entity.components.set(CreditsComponent, { credits: start.credits });
    entity.components.set(ControlBitsComponent,
        new Set([BITS.outfitterErrandOpen]));
    entity.components.set(ActiveRanksComponent, new Set());
    entity.components.set(MissionsComponent, new Map());
    entity.components.set(CargoComponent, new Map());
    entity.components.set(OutfitsStateComponent, new Map());
    entity.components.set(CombatRatingComponent, { kills: 10 });
    entity.components.set(LegalRecordsComponent,
        new Map([[SYNTHETIC.govts.meridian, 5]]));
    return entity;
}

async function universeFor() {
    const gameData = await getSyntheticGameData();
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
    it('rolls the trading, shipyard and outfit missions at their '
        + 'own locations', async () => {
            const { gameData, universe } = await universeFor();
            const session = await MissionSession.create(await pilot(),
                gameData, universe, PORT);
            const rolls = winningRolls(universe);
            const ids = (location: number) => rollOffers(session, universe,
                location, rolls).map(o => o.data.id);
            expect(ids(LOCATION_TRADING)).toContain(TRADING_JOB);
            expect(ids(LOCATION_SHIPYARD)).toContain(SHIPYARD_JOB);
            expect(ids(LOCATION_OUTFIT)).toContain(OUTFIT_JOB);
            // The locations are disjoint.
            expect(ids(LOCATION_TRADING)).not.toContain(SHIPYARD_JOB);
            expect(ids(LOCATION_SHIPYARD)).not.toContain(TRADING_JOB);
        });

    it('presents the venue\'s offer and commits an accept to the '
        + 'entity before the venue opens', async () => {
            const { gameData, universe } = await universeFor();
            const entity = await pilot();
            const { popup, shown } = scriptedPopup((text, hasRefuse) =>
                text.startsWith(TRADING_OFFER) || !hasRefuse
                    ? 'accept' : 'refuse');
            await presentVenueOffers(entity, popup, universe, gameData,
                PORT, LOCATION_TRADING, winningRolls(universe));
            expect(shown.some(text => text.startsWith(TRADING_OFFER)))
                .toBeTrue();
            // Committed: the mission is active and its 20 tons of
            // equipment (PickupMode 0) are aboard, ready for the venue
            // to build its working copy from.
            const active = entity.components.get(MissionsComponent)!
                .get(TRADING_JOB);
            expect(active).toBeDefined();
            expect(active!.cargoLoaded).toBeTrue();
            expect(entity.components.get(CargoComponent)!
                .get(missionCargoKey(TRADING_JOB))).toBe(20);
            expect(entity.components.get(ControlBitsComponent)!
                .has(BITS.errandAccepted)).toBeTrue();
        });

    it('shows the accepted job\'s briefing after the accept', async () => {
        // The briefing half of the spec above, at the outfitter: the
        // AvailLoc 4 and 5 jobs both have an EMPTY BriefText (no briefing
        // popup at all), and the AvailLoc 6 job is the venue job that
        // carries one.
        const { gameData, universe } = await universeFor();
        const entity = await pilot();
        const { popup, shown } = scriptedPopup((text, hasRefuse) =>
            text.startsWith(OUTFIT_OFFER) || !hasRefuse ? 'accept' : 'refuse');
        await presentVenueOffers(entity, popup, universe, gameData,
            PORT, LOCATION_OUTFIT, winningRolls(universe));
        expect(shown.some(text => text.startsWith(OUTFIT_OFFER))).toBeTrue();
        expect(shown.some(text => text.startsWith(OUTFIT_BRIEF))).toBeTrue();
        expect(entity.components.get(MissionsComponent)!.has(OUTFIT_JOB))
            .toBeTrue();
    });

    it('runs OnRefuse and commits that too', async () => {
        const { gameData, universe } = await universeFor();
        const entity = await pilot();
        const { popup } = scriptedPopup((_text, hasRefuse) =>
            hasRefuse ? 'refuse' : 'accept');
        await presentVenueOffers(entity, popup, universe, gameData,
            PORT, LOCATION_TRADING, winningRolls(universe));
        // The AvailLoc 4 job's OnRefuse is "b104", which its own AvailBits
        // (`!b103 & !b104`) then takes off the table for good.
        expect(entity.components.get(MissionsComponent)!
            .has(TRADING_JOB)).toBeFalse();
        expect(entity.components.get(ControlBitsComponent)!
            .has(BITS.errandRefused)).toBeTrue();
    });
});

/**
 * STAYS ON THE STOCK DATA. A missed AvailRandom roll can only silence a
 * mission whose AvailRandom is under 100 (rollOffers does not even draw
 * for a 100% mission), and every mïsn in the synthetic scenario is 100%.
 * Stock nova:428 "Federation Resupply;Fed1", in the outfit dialog at
 * Earth, is a job with a real roll.
 */
describe('venue mission offers that lose their AvailRandom roll', () => {
    const EARTH = 'nova:128';
    const ARGOSY = 'nova:138';

    it('is silent when nothing rolls', async () => {
        const gameData = await getIntegrationGameData();
        const universe = MissionUniverse.shared(gameData);
        await universe.load();
        const start = await gameData.data.PlayerStart.get(EARTH);
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
