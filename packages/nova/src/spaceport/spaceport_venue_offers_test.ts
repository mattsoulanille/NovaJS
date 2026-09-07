import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
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
 * The real Spaceport, driven headlessly against the real stock data, with
 * the venue dialogs themselves stubbed to "open and close at once": what
 * is pinned here is the WIRING — pressing Outfitter / Shipyard / Trade
 * Center rolls that venue's AvailLoc and presents its offers (see
 * venue_offers.ts for the offers themselves). The same pilot as
 * venue_offers_test: an Argosy at Earth, rating 150, Federation record 5,
 * b9200 set.
 */
describe('spaceport venue offers', () => {
    beforeAll(() => installHeadlessPixi());
    afterEach(() => resetOfferRolls());

    const EARTH = 'nova:128';
    const ARGOSY = 'nova:138';

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
        const gameData = await getIntegrationGameData();
        await MissionUniverse.shared(gameData).load();
        const controlEvents = new Subject<ControlEvent>();
        const spaceport = new Spaceport(displayAssets(), gameData, EARTH,
            controlEvents);
        await spaceport.buildPromise;
        // The venues open and close at once: their own dialogs are not
        // what is under test, and the real outfitter would page through
        // every stock oütf's art.
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
        // to under the pilot's bits (Earth's is not sÿst nova:128).
        const universe = MissionUniverse.shared(gameData);
        const rolls = offerRollsForSystem(
            universe.systemIdOfPlanet(EARTH, new Set([9200])));
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

    it('offers the Federation string at the outfitter (nova:428)',
        async () => {
            const { entity, shown, press, venues } =
                await land('As you wander around the outfitting area');
            expect(shown.length).toBe(0);
            await press('outfitter');
            expect(venues.outfitter.show).toHaveBeenCalled();
            expect(shown.some(text =>
                text.startsWith('As you wander around the outfitting area')))
                .toBeTrue();
            expect(entity.components.get(MissionsComponent)!.has('nova:428'))
                .toBeTrue();
        });

    it('offers the Sigma Shipyards string at the shipyard (nova:555)',
        async () => {
            const { entity, shown, press } =
                await land('As you wander through the shipyard');
            await press('shipyard');
            expect(shown.some(text =>
                text.startsWith('As you wander through the shipyard')))
                .toBeTrue();
            expect(entity.components.get(MissionsComponent)!.has('nova:555'))
                .toBeTrue();
        });

    it('offers Tutorial 002 at the trade center (nova:630)', async () => {
        const { entity, shown, press } =
            await land('"This is the lifeblood of our civilization,"');
        await press('tradeCenter');
        expect(shown.some(text =>
            text.startsWith('"This is the lifeblood of our civilization,"')))
            .toBeTrue();
        expect(entity.components.get(MissionsComponent)!.has('nova:630'))
            .toBeTrue();
    });

    it('does not re-offer at a second visit to the same venue', async () => {
        const { shown, press } =
            await land('As you wander around the outfitting area');
        await press('outfitter');
        const afterFirst = shown.length;
        expect(afterFirst).toBeGreaterThan(0);
        await press('outfitter');
        // nova:428 is active now (missions are not offered twice) and its
        // OnAccept b511 fails its own AvailBits; nothing else at the
        // outfitter qualifies.
        expect(shown.length).toBe(afterFirst);
    });
});
