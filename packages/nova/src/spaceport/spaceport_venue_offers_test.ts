import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { BITS, SYNTHETIC } from 'novaparse/synthetic/universe';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { getSyntheticGameData } from '../communication/simulation_test_fixture.js';
import { CargoComponent, makeShip, OutfitsStateComponent } from '../nova_plugin/ship/index.js';
import { ControlEvent } from '../nova_plugin/core/index.js';
import { ActiveRanksComponent, ControlBitsComponent }
    from '../nova_plugin/ncb/index.js';
import {
    CreditsComponent, GameDateComponent, MissionsComponent,
} from '../nova_plugin/player/index.js';
import {
    CombatRatingComponent, LegalRecordsComponent,
} from '../nova_plugin/reputation/index.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { MenuControls } from './menu_controls.js';
import { offerRollsForSystem, resetOfferRolls } from './mission_offers.js';
import { MissionUniverse } from './mission_universe.js';
import { OfferPopup } from './offer_popup.js';
import { Spaceport } from './spaceport.js';

/**
 * ============================================================================
 * The spaceport presents a venue's mission offers as the player walks in
 * ============================================================================
 *
 * The real Spaceport, driven headlessly against the parsed synthetic data
 * set, with the venue dialogs themselves stubbed to "open and close at
 * once": what is pinned here is the WIRING — pressing Outfitter /
 * Shipyard / Trade Center rolls that venue's AvailLoc and presents its
 * offers (see venue_offers.ts for the offers themselves). The same pilot
 * as venue_offers_test: a Heron Warden at Port Amberline, rating 10,
 * Meridian record 5, b105 set.
 */
describe('spaceport venue offers', () => {
    beforeAll(() => installHeadlessPixi());
    afterEach(() => resetOfferRolls());

    const PORT = SYNTHETIC.planets.port;
    const WARDEN = SYNTHETIC.ships.warden;

    // The Bible's AvailLoc numbering: 4 trading, 5 shipyard, 6 outfit
    // (see venue_offers_test.ts).
    /** "Outfitter Errand", AvailLoc 6. */
    const OUTFITTER_JOB = SYNTHETIC.missions.outfitterErrand;
    /** "Shipyard Errand", AvailLoc 5. */
    const SHIPYARD_JOB = SYNTHETIC.missions.shipyardErrand;
    /** "Trade Errand", AvailLoc 4. */
    const TRADING_JOB = SYNTHETIC.missions.tradeErrand;

    /** The first words of each job's offer text (dësc 4000 + n). */
    const OUTFITTER_OFFER = 'The outfitter will pay well for five tons of luxuries';
    const SHIPYARD_OFFER = 'The shipwright wants a hull scan';
    const TRADING_OFFER = 'A trader on the exchange floor has twenty tons of equipment';

    /** Walks back out of whatever a spec left open (see the shipyard
     * docked-swap spec for why the focus stack must be left clean). */
    const openVisits: (() => Promise<void>)[] = [];
    afterEach(async () => {
        while (openVisits.length > 0) {
            await openVisits.pop()!();
        }
    });

    function displayAssets(): DisplayAssetDataInterface {
        return {
            spriteFromPict: () => new PIXI.Sprite(),
            spriteFromPictAsync: async () => new PIXI.Sprite(),
            textureFromPict: () => PIXI.Texture.EMPTY,
            textureFromPictAsync: async () => PIXI.Texture.EMPTY,
            textureFromCicn: async () => PIXI.Texture.EMPTY,
            textureFromPpat: async () => PIXI.Texture.EMPTY,
            data: {
                Sound: { get: async () => undefined },
                StringTable: { get: async () => ({ strings: [] }) },
            },
        } as unknown as DisplayAssetDataInterface;
    }

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

    /** Spins the event loop until `ready` holds (or the spec gives up). */
    async function waitFor(ready: () => boolean) {
        for (let i = 0; i < 2000 && !ready(); i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        expect(ready()).toBe(true);
    }

    async function settle() {
        for (let i = 0; i < 20; i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    /**
     * Lands the pilot with every venue dialog stubbed to return at once and
     * the spaceport's popup replaced by a recorder that ACCEPTS the offer
     * whose text starts with `acceptText` and refuses every other offer.
     */
    async function land(acceptText: string) {
        const gameData = await getSyntheticGameData();
        await MissionUniverse.shared(gameData).load();
        const controlEvents = new Subject<ControlEvent>();
        const spaceport = new Spaceport(displayAssets(), gameData, PORT,
            controlEvents);
        await spaceport.buildPromise;
        // The venues open and close at once: their own dialogs are not
        // what is under test, and the real outfitter would page through
        // every oütf's art.
        const venues = spaceport as unknown as {
            outfitter: { show(e: Entity): Promise<Entity> },
            shipyard: { show(e: Entity): Promise<Entity> },
            tradeCenter: { show(e: Entity): Promise<Entity> },
            offerPopup: OfferPopup,
        };
        for (const venue of [venues.outfitter, venues.shipyard,
            venues.tradeCenter]) {
            spyOn(venue, 'show').and.callFake(async (e: Entity) => e);
        }
        const shown: string[] = [];
        venues.offerPopup = {
            container: venues.offerPopup.container,
            async show(text: string, buttons: { refuse?: string | null }) {
                shown.push(text);
                return text.startsWith(acceptText) || !buttons.refuse
                    ? 'accept' : 'refuse';
            },
        } as unknown as OfferPopup;
        // Every AvailRandom roll of this visit wins. Keyed the way the
        // spaceport keys it: by the SYSTEM the landing stellar resolves
        // to under the pilot's bits.
        const universe = MissionUniverse.shared(gameData);
        const rolls = offerRollsForSystem(universe.systemIdOfPlanet(
            PORT, new Set([BITS.outfitterErrandOpen])));
        for (const mission of universe.missions) {
            rolls.set(mission.id, 0);
        }

        const entity = await pilot();
        const departed = spaceport.show(entity);
        await waitFor(() => spaceport.onMainScreen);
        const press = async (action: ControlEvent['action']) => {
            controlEvents.next({ action, state: 'start' });
            await settle();
            await waitFor(() => spaceport.onMainScreen);
        };
        openVisits.push(async () => {
            for (let i = 0; i < 5 && MenuControls.focused; i++) {
                controlEvents.next({ action: 'depart', state: 'start' });
                await settle();
            }
            await departed;
        });
        return { entity, shown, press, venues };
    }

    it('offers the AvailLoc 6 job at the outfitter', async () => {
        const { entity, shown, press, venues } = await land(OUTFITTER_OFFER);
        expect(shown.length).toBe(0);
        await press('outfitter');
        expect(venues.outfitter.show).toHaveBeenCalled();
        expect(shown.some(text => text.startsWith(OUTFITTER_OFFER)))
            .toBeTrue();
        expect(entity.components.get(MissionsComponent)!.has(OUTFITTER_JOB))
            .toBeTrue();
    });

    it('offers the AvailLoc 5 job at the shipyard', async () => {
        const { entity, shown, press } = await land(SHIPYARD_OFFER);
        await press('shipyard');
        expect(shown.some(text => text.startsWith(SHIPYARD_OFFER)))
            .toBeTrue();
        expect(entity.components.get(MissionsComponent)!.has(SHIPYARD_JOB))
            .toBeTrue();
    });

    it('offers the AvailLoc 4 job at the trade center', async () => {
        const { entity, shown, press } = await land(TRADING_OFFER);
        await press('tradeCenter');
        expect(shown.some(text => text.startsWith(TRADING_OFFER))).toBeTrue();
        expect(entity.components.get(MissionsComponent)!.has(TRADING_JOB))
            .toBeTrue();
    });

    it('does not re-offer at a second visit to the same venue', async () => {
        const { shown, press } = await land(TRADING_OFFER);
        await press('tradeCenter');
        const afterFirst = shown.length;
        expect(afterFirst).toBeGreaterThan(0);
        await press('tradeCenter');
        // The AvailLoc 4 job is active now (missions are not offered
        // twice) and its OnAccept b103 fails its own AvailBits
        // (`!b103 & !b104`); nothing else at the trade center qualifies.
        expect(shown.length).toBe(afterFirst);
    });
});
