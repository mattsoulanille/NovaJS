import 'jasmine';
import { getDefaultMissionData, MissionData } from 'novadatainterface/mission_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultOutfitData, OutfitData } from 'novadatainterface/outfit_data';
import { getDefaultPlanetData } from 'novadatainterface/planet_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { getDefaultSpriteSheetData } from 'novadatainterface/sprite_sheet_data';
import { getDefaultSystemData } from 'novadatainterface/system_data';
import { Entity } from 'nova_ecs/entity';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
import { DockedShip } from '../display/docked_ship.js';
import { ControlEvent } from '../nova_plugin/core/index.js';
import { LOCATION_MAIN_SPACEPORT } from '../nova_plugin/missions/index.js';
import {
    ActiveRanksComponent, ControlBitsComponent, parseNCBSet,
} from '../nova_plugin/ncb/index.js';
import {
    ActiveMission, CreditsComponent, dayNumber, GameDateComponent,
    MissionsComponent, PlayerNamesComponent,
} from '../nova_plugin/player/index.js';
import { CargoComponent, OutfitsStateComponent, ShipComponent } from '../nova_plugin/ship/index.js';
import { requireNovaData } from '../test_support/nova_data_gate.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { PendingDepartureComponent } from './landed_departure.js';
import { LandedTransaction } from './landed_transaction.js';
import { MenuControls } from './menu_controls.js';
import { resetOfferRolls } from './mission_offers.js';
import { MissionUniverse } from './mission_universe.js';
import { OfferPopup } from './offer_popup.js';
import { Outfitter } from './outfitter.js';
import { resolveSetStringSound } from './set_string_requests.js';
import { Spaceport } from './spaceport.js';
import { OpenStarmapOptions } from './starmap.js';

/**
 * ============================================================================
 * Txxx / Pxxx / Mxxx / Nxxx / Qxxx WHILE LANDED, beyond the Q / M / N of
 * landed_departure_test.ts
 * ============================================================================
 *
 *  - `Txxx` renames the ship once the dialog it ran under is closed (stock
 *    mïsn nova:197 / 320 / 361 / 709 / 748 OnAccept, "Dart", "Arrow", ...);
 *  - `Pxxx` plays as its string runs (arpia:983 OnSuccess `P5000`);
 *  - the landing's own date advance (a deadline OnFailure, a crön) feeds
 *    the same departure;
 *  - an M / N without a Q moves the player AT ONCE but leaves him docked
 *    (the map reads the destination as current), an oütf's M launches where
 *    an N does, and an oütf's Q ejects him straight from the outfitter
 *    (MEASURED, reference "M / N without Q while landed (ncbops)").
 */
describe('landed set-string operators (T / P / M / N / Q)', () => {
    beforeAll(() => installHeadlessPixi());
    afterEach(() => {
        resetOfferRolls();
        while (MenuControls.focused) {
            MenuControls.focused.unbind();
        }
    });

    const PLANET = 'nova:128';
    const SYSTEM = 'nova:128';
    const DESTINATION = 'nova:600';
    const SHIP = 'nova:128';
    const MISSION = 'nova:500';
    const OFFER = 'nova:501';
    const MOVE_M = 'nova:600';
    const MOVE_MQ = 'nova:601';
    const QUOTE_TEXT = 'A mysterious force transports you to an unknown '
        + 'location...';
    const TABLES: { [id: string]: string[] } = {
        'nova:700': [QUOTE_TEXT],
        'nova:710': ['Dart', '', 'Dart'],
    };
    const DATE = { day: 10, month: 1, year: 1177 };

    function outfit(id: string, name: string, onPurchase: string): OutfitData {
        return {
            ...getDefaultOutfitData(), id, name, pict: '', price: 1000,
            max: 3, buyRandom: 100, onPurchase,
        };
    }

    function gameData(missions: Partial<MissionData>[] = [],
        outfits: OutfitData[] = []): MockGameData {
        const data = new MockGameData();
        data.data.Planet.map.set(PLANET, {
            ...getDefaultPlanetData(), id: PLANET, name: 'Viking',
            landingPict: '', landingDesc: '',
            flags: {
                ...getDefaultPlanetData().flags,
                hasShipyard: false, hasOutfitter: outfits.length > 0,
                hasBar: false, hasCommodityExchange: false,
            },
        });
        for (const id of [SYSTEM, DESTINATION]) {
            data.data.System.map.set(id, {
                ...getDefaultSystemData(), id,
                planets: id === SYSTEM ? [PLANET] : [],
            });
        }
        data.data.Ship.map.set(SHIP, {
            ...getDefaultShipData(), id: SHIP, pict: '',
            physics: {
                ...getDefaultShipData().physics, freeMass: 50, freeCargo: 50,
            },
        });
        for (const mission of missions) {
            data.data.Mission.map.set(mission.id!, {
                ...getDefaultMissionData(), ...mission,
            } as MissionData);
        }
        for (const item of outfits) {
            data.data.Outfit.map.set(item.id, item);
        }
        data.data.SpriteSheet.map.set('nova:0', getDefaultSpriteSheetData());
        return data;
    }

    function active(id: string, deadlineDay: number | null = null):
        ActiveMission {
        return {
            id, acceptedDay: dayNumber(DATE) - 5, acceptedAt: PLANET,
            travelPlanet: null, returnPlanet: PLANET, cargoType: -1,
            cargoQty: 0, cargoLoaded: false, travelDone: false,
            deadlineDay,
        };
    }

    function pilot(missions: ActiveMission[] = []): Entity {
        return new Entity('pilot')
            .addComponent(ShipComponent, { id: SHIP })
            .addComponent(MultiplayerData, { owner: 'peer-1' })
            .addComponent(CreditsComponent, { credits: 1_000_000 })
            .addComponent(OutfitsStateComponent, new Map())
            .addComponent(CargoComponent, new Map())
            .addComponent(MissionsComponent,
                new Map(missions.map(m => [m.id, m])))
            .addComponent(ControlBitsComponent, new Set<number>())
            .addComponent(ActiveRanksComponent, new Set<string>())
            .addComponent(GameDateComponent, { ...DATE });
    }

    function displayAssets(): DisplayAssetDataInterface {
        return {
            spriteFromPict: () => new PIXI.Sprite(),
            spriteFromPictAsync: async () => new PIXI.Sprite(),
            textureFromPict: () => PIXI.Texture.EMPTY,
            textureFromPictAsync: async () => PIXI.Texture.EMPTY,
            textureFromCicn: async () => PIXI.Texture.EMPTY,
            textureFromPpat: async () => PIXI.Texture.EMPTY,
            data: {
                Sound: {
                    get: async (id: string) => {
                        if (id !== 'nova:720') {
                            throw new Error(`no snd ${id}`);
                        }
                        return {};
                    },
                },
                StringTable: {
                    get: async (id: string) => {
                        if (!TABLES[id]) {
                            throw new Error(`no STR# ${id}`);
                        }
                        return { id, strings: TABLES[id] };
                    },
                },
            },
        } as unknown as DisplayAssetDataInterface;
    }

    async function landing(data: MockGameData, entity: Entity) {
        const sim = data as unknown as SimulationGameDataInterface;
        const universe = new MissionUniverse(sim);
        await universe.load();
        return LandedTransaction.open(entity, sim, universe, PLANET);
    }

    async function settle() {
        for (let i = 0; i < 20; i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    async function waitFor(ready: () => boolean, what = 'ready') {
        for (let i = 0; i < 2000 && !ready(); i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        expect(ready()).withContext(what).toBe(true);
    }

    async function land(data: MockGameData, entity: Entity,
        openStarmap?: (options?: OpenStarmapOptions) => Promise<unknown>) {
        const controlEvents = new Subject<ControlEvent>();
        const spaceport = new Spaceport(displayAssets(),
            data as unknown as SimulationGameDataInterface, PLANET,
            controlEvents, openStarmap);
        await spaceport.buildPromise;
        spaceport.setDockedShip(new DockedShip(entity, () => { }));
        const sounds: string[] = [];
        spaceport.setUiSoundPlayer(id => sounds.push(id));
        let departedWith: Entity | undefined;
        const departed = spaceport.show(entity)
            .then(hull => departedWith = hull);
        const press = async (action: ControlEvent['action']) => {
            controlEvents.next({ action, state: 'start' });
            await settle();
        };
        return {
            spaceport, departed, press, sounds,
            hull: () => departedWith,
        };
    }

    function popupOf(spaceport: Spaceport) {
        const popup = (spaceport as unknown as { offerPopup: OfferPopup })
            .offerPopup;
        return {
            popup,
            answer: (choice: 'accept' | 'refuse') => (popup as unknown as {
                choice: Subject<'accept' | 'refuse'>,
            }).choice.next(choice),
        };
    }

    describe('Txxx', () => {
        it('renames the hull from its STR# once the offer it ran under is '
            + 'closed (stock nova:197\'s `T25040` shape)', async () => {
                const { spaceport, departed, press, hull } = await land(
                    gameData([{
                        id: OFFER, availLoc: LOCATION_MAIN_SPACEPORT,
                        availRandom: 100, offerText: 'Fly the Dart?',
                        acceptButton: 'Sure', refuseButton: 'No',
                        onAccept: 'T710',
                    }]), pilot());
                const { popup, answer } = popupOf(spaceport);
                await waitFor(() => popup.container.visible, 'the offer');
                answer('accept');
                await waitFor(() => spaceport.onMainScreen, 'the port');
                await settle();
                await press('depart');
                await departed;
                expect(hull()!.components.get(PlayerNamesComponent)?.ship)
                    .toBe('Dart');
            });

        it('is taken back with the rest of a rolled-back venue', async () => {
            const transaction = await landing(gameData(), pilot());
            const visit = transaction.savepoint('bar');
            transaction.session.machinery.renameShip!(710, 'nova');
            transaction.rollback(visit);
            expect(transaction.takeShipNames()).toEqual([]);
        });
    });

    describe('Pxxx', () => {
        it('plays as the completion\'s string runs (arpia:983\'s `P5000` '
            + 'shape), resolved stock-first', async () => {
                const transaction = await landing(gameData([{
                    id: MISSION, name: 'Back home', returnStel: 128,
                    returnStelId: PLANET, onSuccess: 'P720 b5',
                    completionText: 'Done.',
                }]), pilot([active(MISSION)]));
                const played: { soundId: number, prefix: string }[] = [];
                transaction.onSound = sound => played.push(sound);
                await transaction.processLanding();
                expect(played).toEqual([{ soundId: 720, prefix: 'nova' }]);
                expect(await resolveSetStringSound(displayAssets(),
                    played[0])).toBe('nova:720');
                expect(await resolveSetStringSound(displayAssets(),
                    { soundId: 5000, prefix: 'arpia' })).toBeUndefined();
            });

        it('reaches the spaceport\'s UI channel', async () => {
            const { spaceport, sounds } = await land(gameData([{
                id: MISSION, name: 'Back home', returnStel: 128,
                returnStelId: PLANET, onSuccess: 'P720',
                completionText: 'Done.',
            }]), pilot([active(MISSION)]));
            await waitFor(() => sounds.length > 0, 'the sound');
            expect(sounds).toEqual(['nova:720']);
            const { popup, answer } = popupOf(spaceport);
            await waitFor(() => popup.container.visible, 'the text');
            answer('accept');
        });
    });

    describe('the landing\'s date advance', () => {
        it('feeds a deadline OnFailure\'s Q and M into the departure (the '
            + 'duellists\' `Q7999`, arpia:1038\'s `M500`)', async () => {
                const transaction = await landing(gameData([{
                    id: MISSION, name: 'Late', onFailure: 'Q700 M600',
                }]), pilot([active(MISSION, dayNumber(DATE) - 1)]));
                await transaction.processLanding();
                expect(transaction.state.missions.has(MISSION)).toBeFalse();
                expect(transaction.mustLeave).toBeTrue();
                expect(transaction.departure.quotes).toEqual(
                    [{ stringId: 700, prefix: 'nova' }]);
                expect(transaction.movedToSystem).toBe(DESTINATION);
            });
    });

    describe('an oütf\'s M / N / Q (ncbops)', () => {
        const OUTFITS = [
            outfit(MOVE_M, 'NO Move M', 'M600'),
            outfit(MOVE_MQ, 'NO Move MQ', 'M600 Q700'),
        ];

        async function shop(openStarmap?:
            (options?: OpenStarmapOptions) => Promise<unknown>) {
            const landed = await land(gameData([], OUTFITS), pilot(),
                openStarmap);
            const { spaceport, press } = landed;
            await waitFor(() => spaceport.onMainScreen, 'the port');
            await press('outfitter');
            await waitFor(() => !spaceport.onMainScreen, 'the outfitter');
            const view = (spaceport as unknown as { outfitter: Outfitter })
                .outfitter as unknown as {
                    shipData?: unknown,
                    itemGrid?: { selection?: OutfitData, items: OutfitData[] },
                    buyOutfit(): void,
                    container: PIXI.Container,
                };
            await waitFor(() => view.shipData !== undefined
                && (view.itemGrid?.items.length ?? 0) === OUTFITS.length,
                'the outfitter stocked');
            const buy = (id: string) => {
                view.itemGrid!.selection =
                    view.itemGrid!.items.find(item => item.id === id)!;
                view.buyOutfit();
            };
            const transaction = () => (spaceport as unknown as {
                transaction?: LandedTransaction,
            }).transaction;
            return { ...landed, view, buy, transaction };
        }

        it('M alone: stays docked, the map reads the destination as current, '
            + 'and the Leave launches at the docked stellar\'s x/y (as N)',
            async () => {
                const maps: (OpenStarmapOptions | undefined)[] = [];
                const { spaceport, view, buy, press, departed, hull,
                    transaction } = await shop(async options => {
                        maps.push(options);
                        return [];
                    });
                buy(MOVE_M);
                await settle();
                expect(view.container.visible).withContext('still shopping')
                    .toBeTrue();
                expect(transaction()!.movedToSystem).toBe(DESTINATION);
                await press('depart');
                await waitFor(() => spaceport.onMainScreen, 'back in port');
                (spaceport as unknown as { openDockedMap(): void })
                    .openDockedMap();
                expect(maps[maps.length - 1]?.currentSystemId)
                    .toBe(DESTINATION);
                expect(spaceport.container.visible).toBeTrue();
                await press('depart');
                await departed;
                expect(hull()!.components.get(PendingDepartureComponent))
                    .toEqual({
                        move: { systemId: DESTINATION, keepCoordinates: true },
                        statusMessages: [],
                    });
            });

        it('M with Q: ejected straight from the outfitter', async () => {
            const { view, buy, departed, hull } = await shop();
            buy(MOVE_MQ);
            await departed;
            expect(view.container.visible).toBeFalse();
            expect(hull()!.components.get(PendingDepartureComponent))
                .toEqual({
                    move: { systemId: DESTINATION, keepCoordinates: true },
                    statusMessages: [QUOTE_TEXT],
                });
        });
    });

    describe('against the real data', () => {
        beforeEach(requireNovaData);

        it('stock\'s T and Q tables read as the operators expect', async () => {
            const data = await getIntegrationGameData();
            expect((await data.data.StringTable.get('nova:25040')).strings[0])
                .toBe('Dart');
            const dart = await data.data.Mission.get('nova:197');
            expect(parseNCBSet(dart.onAccept)).toContain(
                jasmine.objectContaining({ type: 'renameShip',
                    stringId: 25040 }));
            const recording = await data.data.Mission.get('nova:156');
            expect(parseNCBSet(recording.onShipDone)).toEqual([
                { type: 'leaveStellar', stringId: 25059 }]);
            expect((await data.data.StringTable.get('nova:25059')).strings)
                .toEqual(['Holographic recording complete.  Return to '
                    + 'P\'ar Aed.']);
        });
    });
});
