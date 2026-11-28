import 'jasmine';
import { getDefaultMissionData, MissionData } from 'novadatainterface/mission_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultPlanetData } from 'novadatainterface/planet_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { getDefaultSystemData } from 'novadatainterface/system_data';
import { Entity } from 'nova_ecs/entity';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { takePendingDeparture } from '../client/docking.js';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
import { ControlEvent } from '../nova_plugin/core/index.js';
import { LOCATION_MAIN_SPACEPORT } from '../nova_plugin/missions/index.js';
import { ControlBitsComponent, parseNCBSet } from '../nova_plugin/ncb/index.js';
import {
    ActiveMission, CreditsComponent, dayNumber, GameDateComponent,
    MissionsComponent,
} from '../nova_plugin/player/index.js';
import { CargoComponent, OutfitsStateComponent, ShipComponent } from '../nova_plugin/ship/index.js';
import { novaDataInstalled, requireNovaData } from '../test_support/nova_data_gate.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { PendingDepartureComponent } from './landed_departure.js';
import { LandedTransaction } from './landed_transaction.js';
import { MenuControls } from './menu_controls.js';
import { MissionUniverse } from './mission_universe.js';
import { OfferPopup } from './offer_popup.js';
import { Spaceport } from './spaceport.js';

/**
 * ============================================================================
 * Qxxx / Mxxx / Nxxx WHILE LANDED (landed_departure.ts)
 * ============================================================================
 *
 * Matthew, 2026-11-27: "When I land on Heraan to complete the last mission
 * in the Auroran mission string and click through the last dialog box, it
 * should immediately kick me out of the spaceport back into space in the
 * S7evyn system." mïsn nova:686's OnSuccess is
 * `b236 b332 b333 b334 b613 b9995 b9500 M472 Q25048`; before this, the
 * landing ran it with neither hook wired, so both operators were logged as
 * unimplemented and the player stayed landed at Heraan.
 *
 * The rules pinned here: the landing's transaction RECORDS the requests
 * (and a savepoint rollback takes them back); a Q makes the spaceport
 * leave after the dialog it ran under, through the ordinary Leave, with
 * nothing further offered; the departing hull carries the move and the
 * expanded messages to the client's lift-off; an M without a Q keeps the
 * player landed until they Leave.
 */
describe('a landed Qxxx / Mxxx / Nxxx', () => {
    beforeAll(() => installHeadlessPixi());

    const PLANET = 'nova:128';
    const SYSTEM = 'nova:128';
    const DESTINATION = 'nova:600';
    const SHIP = 'nova:128';
    const FINALE = 'nova:500';
    const OFFER = 'nova:501';
    const SECOND_OFFER = 'nova:502';
    const QUOTE = 'nova:700';
    const QUOTE_TEXT = 'A mysterious force transports you to an unknown '
        + 'location...';
    const DATE = { day: 1, month: 1, year: 1177 };

    function gameData(missions: Partial<MissionData>[] = []): MockGameData {
        const data = new MockGameData();
        data.data.Planet.map.set(PLANET, {
            ...getDefaultPlanetData(), id: PLANET, name: 'Heraan',
            landingPict: '', landingDesc: '',
            flags: {
                ...getDefaultPlanetData().flags,
                hasShipyard: false, hasOutfitter: false, hasBar: false,
                hasCommodityExchange: false,
            },
        });
        for (const id of [SYSTEM, DESTINATION]) {
            data.data.System.map.set(id, {
                ...getDefaultSystemData(), id,
                planets: id === SYSTEM ? [PLANET] : [],
            });
        }
        data.data.Ship.map.set(SHIP, { ...getDefaultShipData(), id: SHIP, pict: '' });
        for (const mission of missions) {
            data.data.Mission.map.set(mission.id!, {
                ...getDefaultMissionData(), ...mission,
            } as MissionData);
        }
        return data;
    }

    /** The finale, returning here, with `onSuccess` and a completion text. */
    function finale(onSuccess: string): Partial<MissionData> {
        return {
            id: FINALE, name: 'Return to Heraan', returnStel: 128,
            returnStelId: PLANET, onSuccess, completionText: 'You won.',
        };
    }

    /** A main-spaceport offer, always on. */
    function offer(id: string, onAccept = '', offerText = 'Help us?'):
        Partial<MissionData> {
        return {
            id, availLoc: LOCATION_MAIN_SPACEPORT, availRandom: 100,
            offerText, acceptButton: 'Sure', refuseButton: 'No', onAccept,
        };
    }

    function active(id: string): ActiveMission {
        return {
            id, acceptedDay: dayNumber(DATE), acceptedAt: PLANET,
            travelPlanet: null, returnPlanet: PLANET, cargoType: -1,
            cargoQty: 0, cargoLoaded: false, travelDone: false,
            deadlineDay: null,
        };
    }

    function pilot(missions: string[] = []): Entity {
        return new Entity('pilot')
            .addComponent(ShipComponent, { id: SHIP })
            .addComponent(CreditsComponent, { credits: 1000 })
            .addComponent(OutfitsStateComponent, new Map())
            .addComponent(CargoComponent, new Map())
            .addComponent(MissionsComponent,
                new Map(missions.map(id => [id, active(id)])))
            .addComponent(ControlBitsComponent, new Set<number>())
            .addComponent(GameDateComponent, { ...DATE });
    }

    async function landing(data: MockGameData, entity: Entity) {
        const sim = data as unknown as SimulationGameDataInterface;
        const universe = new MissionUniverse(sim);
        await universe.load();
        return LandedTransaction.open(entity, sim, universe, PLANET);
    }

    describe('the landing\'s transaction', () => {
        it('records a completion\'s M and Q (the Auroran finale\'s shape)',
            async () => {
                const transaction = await landing(
                    gameData([finale('b236 M600 Q700')]), pilot([FINALE]));
                expect(transaction.mustLeave).toBeFalse();
                await transaction.processLanding();
                expect(transaction.mustLeave).toBeTrue();
                expect(transaction.departure.move).toEqual(
                    { systemId: DESTINATION, keepCoordinates: false });
                expect(transaction.departure.quotes).toEqual(
                    [{ stringId: 700, prefix: 'nova' }]);
                // The rest of the string ran as before.
                expect(transaction.state.bits.has(236)).toBeTrue();
                expect(transaction.state.missions.has(FINALE)).toBeFalse();
            });

        it('records an N as keeping the coordinates; the last move wins',
            async () => {
                const transaction = await landing(
                    gameData([finale('M128 N600')]), pilot([FINALE]));
                await transaction.processLanding();
                expect(transaction.departure.move).toEqual(
                    { systemId: DESTINATION, keepCoordinates: true });
            });

        it('does not ask to leave for an M alone: the next Leave goes there',
            async () => {
                const transaction = await landing(
                    gameData([finale('M600')]), pilot([FINALE]));
                await transaction.processLanding();
                expect(transaction.mustLeave).toBeFalse();
                expect(transaction.departure.move?.systemId).toBe(DESTINATION);
            });

        it('takes a venue\'s request back when the venue is rolled back',
            async () => {
                const transaction = await landing(gameData(), pilot());
                const visit = transaction.savepoint('bar');
                transaction.session.machinery.leaveStellar!(700, 'nova');
                transaction.session.machinery.moveToSystem!(DESTINATION,
                    false);
                expect(transaction.mustLeave).toBeTrue();
                transaction.rollback(visit);
                expect(transaction.mustLeave).toBeFalse();
                expect(transaction.departure.move).toBeUndefined();
                expect(transaction.departure.quotes).toEqual([]);
            });
    });

    describe('the spaceport', () => {
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
                    StringTable: {
                        get: async (id: string) => {
                            if (id !== QUOTE) {
                                throw new Error(`no STR# ${id}`);
                            }
                            return { id, strings: [QUOTE_TEXT] };
                        },
                    },
                },
            } as unknown as DisplayAssetDataInterface;
        }

        async function waitFor(ready: () => boolean) {
            for (let i = 0; i < 2000 && !ready(); i++) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
            expect(ready()).toBe(true);
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

        async function land(data: MockGameData, entity: Entity) {
            const spaceport = new Spaceport(displayAssets(),
                data as unknown as SimulationGameDataInterface, PLANET,
                new Subject<ControlEvent>());
            await spaceport.buildPromise;
            let departedWith: Entity | undefined;
            const departed = spaceport.show(entity)
                .then(hull => departedWith = hull);
            return { spaceport, departed, hull: () => departedWith };
        }

        afterEach(() => {
            while (MenuControls.focused) {
                MenuControls.focused.unbind();
            }
        });

        it('leaves by itself once the completion text is closed, offering '
            + 'nothing further, and hands the lift-off the move and the '
            + 'message', async () => {
                const { spaceport, departed, hull } = await land(gameData([
                    finale('b236 M600 Q700'), offer(OFFER),
                ]), pilot([FINALE]));
                const { popup, answer } = popupOf(spaceport);
                await waitFor(() => popup.container.visible);
                // Still landed under the completion text.
                expect(hull()).toBeUndefined();
                answer('accept');
                await departed;
                expect(spaceport.container.visible).toBeFalse();
                const departing = hull()!;
                // Nothing offered after the completion (the AvailLoc 3
                // offer never went up): the mission is not active.
                expect(departing.components.get(MissionsComponent)!.has(OFFER))
                    .toBeFalse();
                expect(departing.components.get(MissionsComponent)!.has(FINALE))
                    .toBeFalse();
                expect(departing.components.get(PendingDepartureComponent))
                    .toEqual({
                        move: { systemId: DESTINATION, keepCoordinates: false },
                        statusMessages: [QUOTE_TEXT],
                    });
                // The client strips it before the hull is encoded.
                expect(takePendingDeparture(departing)?.move?.systemId)
                    .toBe(DESTINATION);
                expect(departing.components.has(PendingDepartureComponent))
                    .toBeFalse();
                expect(MenuControls.focused).toBeUndefined();
            });

        it('leaves after an accepted offer whose OnAccept runs a Q, and puts '
            + 'no further offer to the player', async () => {
                const { spaceport, departed, hull } = await land(gameData([
                    offer(OFFER, 'Q700', 'First?'),
                    offer(SECOND_OFFER, '', 'Second?'),
                ]), pilot());
                const { popup, answer } = popupOf(spaceport);
                await waitFor(() => popup.container.visible);
                answer('accept');
                await departed;
                const departing = hull()!;
                const missions = departing.components.get(MissionsComponent)!;
                // Exactly one of the two was accepted (the visit's order is
                // the roll's); the other was never put.
                expect(missions.size).toBe(1);
                expect(departing.components.get(PendingDepartureComponent))
                    .toEqual({ statusMessages: [QUOTE_TEXT] });
            });

        it('stays landed for an M alone, and the player\'s own Leave carries '
            + 'the move', async () => {
                const controlEvents = new Subject<ControlEvent>();
                const spaceport = new Spaceport(displayAssets(),
                    gameData([finale('M600')]) as unknown as
                    SimulationGameDataInterface, PLANET, controlEvents);
                await spaceport.buildPromise;
                const departed = spaceport.show(pilot([FINALE]));
                const { popup, answer } = popupOf(spaceport);
                await waitFor(() => popup.container.visible);
                answer('accept');
                await waitFor(() => spaceport.onMainScreen);
                await new Promise(resolve => setTimeout(resolve, 20));
                expect(spaceport.container.visible).toBeTrue();
                controlEvents.next({ action: 'depart', state: 'start' });
                const departing = await departed;
                expect(departing.components.get(PendingDepartureComponent))
                    .toEqual({
                        move: { systemId: DESTINATION, keepCoordinates: false },
                        statusMessages: [],
                    });
            });

        it('carries nothing on an ordinary Leave', async () => {
            const controlEvents = new Subject<ControlEvent>();
            const spaceport = new Spaceport(displayAssets(),
                gameData() as unknown as SimulationGameDataInterface, PLANET,
                controlEvents);
            await spaceport.buildPromise;
            const departed = spaceport.show(pilot());
            await waitFor(() => spaceport.onMainScreen);
            controlEvents.next({ action: 'depart', state: 'start' });
            const departing = await departed;
            expect(departing.components.has(PendingDepartureComponent))
                .toBeFalse();
        });
    });

    describe('against the real stock data', () => {
        const HERAAN = 'nova:431';
        const AURORAN_FINALE = 'nova:686';

        beforeEach(requireNovaData);

        it('the Auroran finale (mïsn nova:686) completes at Heraan with '
            + 'M472 Q25048', async () => {
                const data = await getIntegrationGameData();
                const mission = await data.data.Mission.get(AURORAN_FINALE);
                expect(mission.returnStelId).toBe(HERAAN);
                const operations = parseNCBSet(mission.onSuccess);
                expect(operations).toContain(jasmine.objectContaining(
                    { type: 'moveToSystem', id: 472, keepCoordinates: false }));
                expect(operations).toContain(jasmine.objectContaining(
                    { type: 'leaveStellar', stringId: 25048 }));
                const quote = await data.data.StringTable.get('nova:25048');
                expect(quote.strings).toEqual([QUOTE_TEXT]);
            });

        it('landing at Heraan with it active asks to leave for sÿst 472',
            async () => {
                if (!novaDataInstalled()) {
                    return;
                }
                const data = await getIntegrationGameData() as unknown as
                    SimulationGameDataInterface;
                const universe = MissionUniverse.shared(data);
                await universe.load();
                const heraan = await data.data.Planet.get(HERAAN);
                expect(heraan.name).toBe('Heraan');
                const entity = pilot().addComponent(MissionsComponent,
                    new Map([[AURORAN_FINALE, {
                        ...active(AURORAN_FINALE), acceptedAt: HERAAN,
                        returnPlanet: HERAAN,
                    }]]));
                entity.components.set(ShipComponent, { id: 'nova:128' });
                const transaction = await LandedTransaction.open(entity, data,
                    universe, HERAAN);
                await transaction.processLanding();
                expect(transaction.mustLeave).toBeTrue();
                expect(transaction.departure.move).toEqual(
                    { systemId: 'nova:472', keepCoordinates: false });
                expect(transaction.departure.quotes).toEqual(
                    [{ stringId: 25048, prefix: 'nova' }]);
            });
    });
});
