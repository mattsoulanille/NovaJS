import 'jasmine';
import { getDefaultOutfitData } from 'novadatainterface/outfit_data';
import { getDefaultPlanetData, PlanetData } from 'novadatainterface/planet_data';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import { getDefaultSpriteSheetData } from 'novadatainterface/sprite_sheet_data';
import { Entity } from 'nova_ecs/entity';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { DockedShip } from '../display/docked_ship.js';
import { ControlEvent } from '../nova_plugin/core/index.js';
import { ActiveRanksComponent, ControlBitsComponent } from '../nova_plugin/ncb/index.js';
import {
    CreditsComponent, GameDateComponent, PlayerEscortComponent, PlayerShipSelector,
    StoredShipsComponent,
} from '../nova_plugin/player/index.js';
import {
    CargoComponent, OutfitsStateComponent, ShipComponent,
} from '../nova_plugin/ship/index.js';
import { Button, ButtonClick } from './button.js';
import { HangarDialog } from './hangar_dialog.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { CarriedEscort } from './landed_escorts.js';
import { MenuControls } from './menu_controls.js';
import { buildEscortFromRecord } from './ship_storage.js';
import { Shipyard } from './shipyard.js';
import { Spaceport } from './spaceport.js';

/**
 * ============================================================================
 * Ship storage, landed to lift-off, through the real Spaceport
 * ============================================================================
 *
 * The hangar is driven headlessly inside the REAL Spaceport and Shipyard
 * (mock game data, as shipyard_docked_swap_test.ts does): every swap moves
 * the client's docked handle to the new hull at the click, as a purchase
 * does; the escort operations edit the client's landed roster in place;
 * and the Leave commits the hull that carries it all — which is what the
 * lift-off encodes into its insertion record. (The records' trip through a
 * room, with a rollback and a late joiner, is
 * communication/ship_storage_rollback_test.ts.)
 */
describe('ship storage from the shipyard to the lift-off', () => {
    beforeAll(() => installHeadlessPixi());

    const openVisits: (() => Promise<void>)[] = [];
    afterEach(async () => {
        while (openVisits.length > 0) {
            await openVisits.pop()!();
        }
    });

    const PLANET_ID = 'nova:200';
    const PLAYER = 'player-uuid';
    const FLOWN = 'nova:128';
    const STORED = 'nova:129';
    const PRIZE = 'nova:130';
    const BLASTER = 'nova:300';

    function ship(id: string, name: string): ShipData {
        const base = getDefaultShipData();
        return {
            ...base, id, name, pict: '', buyRandom: 100,
            physics: { ...base.physics, freeCargo: 20 },
        };
    }
    const SHIPS = new Map<string, ShipData>([
        [FLOWN, ship(FLOWN, 'Runabout')],
        [STORED, ship(STORED, 'Hauler')],
        [PRIZE, ship(PRIZE, 'Prize')],
    ]);

    function planet(): PlanetData {
        return {
            ...getDefaultPlanetData(), id: PLANET_ID, name: 'Testworld',
            landingPict: '', landingDesc: '',
            flags: {
                ...getDefaultPlanetData().flags,
                hasShipyard: true, hasOutfitter: false, hasBar: false,
                hasCommodityExchange: false,
            },
        } as PlanetData;
    }

    function displayAssets(): DisplayAssetDataInterface {
        return {
            spriteFromPict: () => new PIXI.Sprite(),
            spriteFromPictAsync: async () => new PIXI.Sprite(),
            textureFromPict: () => PIXI.Texture.EMPTY,
            textureFromPictAsync: async () => PIXI.Texture.EMPTY,
            textureFromCicn: async () => PIXI.Texture.EMPTY,
            textureFromPpat: async () => PIXI.Texture.EMPTY,
            data: { Sound: { get: async () => undefined } },
        } as unknown as DisplayAssetDataInterface;
    }

    function simulationData(): SimulationGameDataInterface {
        const outfits = new Map([[BLASTER,
            { ...getDefaultOutfitData(), id: BLASTER, name: 'Blaster', pict: '' }]]);
        const empty = { get: async () => undefined, getCached: () => undefined };
        const spriteSheet = getDefaultSpriteSheetData();
        return {
            ids: Promise.resolve({
                Ship: [...SHIPS.keys()], Outfit: [BLASTER], Govt: [],
                Weapon: [], Planet: [PLANET_ID], System: [], Mission: [],
                Pers: [], Cron: [], Rank: [], Fleet: [], Dude: [], Junk: [],
                Oops: [], Asteroid: [], SpriteSheet: [], PlayerStart: [],
            }),
            data: {
                ...empty,
                Ship: {
                    get: async (id: string) => SHIPS.get(id),
                    getCached: (id: string) => SHIPS.get(id),
                },
                Outfit: {
                    get: async (id: string) => outfits.get(id),
                    getCached: (id: string) => outfits.get(id),
                },
                Govt: empty,
                Planet: {
                    get: async () => planet(),
                    getCached: () => planet(),
                },
                Mission: empty, Cron: empty, Rank: empty, Pers: empty,
                Junk: empty, Oops: empty, System: empty, Weapon: empty,
                SpriteSheet: {
                    get: async () => spriteSheet,
                    getCached: () => spriteSheet,
                },
            },
        } as unknown as SimulationGameDataInterface;
    }

    async function settle(): Promise<void> {
        for (let i = 0; i < 20; i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    async function waitFor(ready: () => boolean) {
        for (let i = 0; i < 2000 && !ready(); i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        expect(ready()).toBe(true);
        // ...and lets whatever the change set off (the hangar's rebuild of
        // its grid) finish before the next key.
        await settle();
    }

    it('swaps, stores and assigns ships at the shipyard, follows each new '
        + 'hull with the docked handle, and lifts off with all of it',
        async () => {
            const controlEvents = new Subject<ControlEvent>();
            const gameData = simulationData();
            const lookups = {
                getShip: (id: string) => SHIPS.get(id),
                getOutfit: () => undefined,
            };
            const spaceport = new Spaceport(displayAssets(), gameData,
                PLANET_ID, controlEvents);
            await spaceport.buildPromise;

            const entity = new Entity('pilot')
                .addComponent(ShipComponent, { id: FLOWN })
                .addComponent(PlayerShipSelector, undefined)
                .addComponent(MultiplayerData, { owner: 'peer-1' })
                .addComponent(CreditsComponent, { credits: 5_000 })
                .addComponent(OutfitsStateComponent,
                    new Map([[BLASTER, { count: 1 }]]))
                .addComponent(CargoComponent, new Map())
                .addComponent(ControlBitsComponent, new Set<number>())
                .addComponent(ActiveRanksComponent, new Set<string>())
                .addComponent(GameDateComponent, { day: 1, month: 1, year: 1177 })
                .addComponent(StoredShipsComponent, [{
                    ship: STORED, name: 'Hauler', outfits: [[BLASTER, 3]],
                    cargo: [], fuel: 100, storedAt: 'nova:201',
                }]);
            const client = { uuid: PLAYER, entity, planetId: PLANET_ID };
            spaceport.setDockedShip(new DockedShip(entity,
                ship => { client.entity = ship; }));
            const roster: CarriedEscort[] = [{
                player: PLAYER, uuid: 'prize',
                entity: buildEscortFromRecord({
                    ship: PRIZE, name: 'Prize', outfits: [], cargo: [],
                    fuel: 50, storedAt: PLANET_ID,
                }, PLAYER, lookups),
            }];
            spaceport.setLandedEscorts(() => roster, PLAYER, []);

            const departed = spaceport.show(entity);
            await waitFor(() => spaceport.onMainScreen);
            const press = async (action: ControlEvent['action']) => {
                controlEvents.next({ action, state: 'start' });
                await settle();
            };
            openVisits.push(async () => {
                for (let i = 0; i < 5 && MenuControls.focused; i++) {
                    await press('depart');
                }
            });

            await press('shipyard');
            await waitFor(() => !spaceport.onMainScreen);
            const shipyard = (spaceport as unknown as { shipyard: Shipyard })
                .shipyard;
            const internals = shipyard as unknown as {
                hangar: HangarDialog, hangarButton: Button,
            };
            const hangar = internals.hangar;
            const click = (button: { click: Subject<ButtonClick> }) =>
                button.click.next({ option: false, shift: false });

            click(internals.hangarButton);
            await waitFor(() => hangar.container.visible);
            // Tiles: flying, the stored Hauler, the Prize escort.
            await press('right');
            click(hangar.buttons.swap);
            await waitFor(() =>
                client.entity.components.get(ShipComponent)?.id === STORED);
            expect(client.entity).not.toBe(entity);
            expect(client.entity.components.get(OutfitsStateComponent))
                .toEqual(new Map([[BLASTER, { count: 3 }]]));
            expect(client.entity.components.get(StoredShipsComponent)
                ?.map(stored => stored.ship)).toEqual([FLOWN]);

            // Swap with the escort (the third tile; the grid reselected the
            // flying ship after the swap).
            await press('right');
            await press('right');
            const hauler = client.entity;
            click(hangar.buttons.swap);
            await waitFor(() =>
                client.entity.components.get(ShipComponent)?.id === PRIZE);
            expect(roster.length).toBe(1);
            expect(roster[0].uuid).toBe('prize');
            expect(roster[0].entity.components.get(ShipComponent)?.id)
                .toBe(STORED);
            expect(hauler.components.get(ShipComponent)?.id).toBe(STORED);

            // Store that escort (the Hauler), then send the stored Runabout
            // along as an escort.
            await press('right');
            await press('right');
            click(hangar.buttons.move);
            await waitFor(() => roster.length === 0);
            expect(client.entity.components.get(StoredShipsComponent)
                ?.map(stored => stored.ship)).toEqual([FLOWN, STORED]);
            // The ship just stored is selected; the Runabout is left of it.
            await press('left');
            click(hangar.buttons.move);
            await waitFor(() => roster.length === 1);
            expect(roster[0].entity.components.get(ShipComponent)?.id)
                .toBe(FLOWN);
            expect(roster[0].entity.components.get(PlayerEscortComponent)
                ?.provenance).toBe('captured');
            expect(client.entity.components.get(StoredShipsComponent)
                ?.map(stored => stored.ship)).toEqual([STORED]);

            // Out of the hangar, out of the shipyard, and Leave.
            await press('depart');
            await waitFor(() => !hangar.container.visible);
            await press('depart');
            await waitFor(() => spaceport.onMainScreen);
            await press('depart');
            const lifted = await departed;
            expect(lifted).toBe(client.entity);
            expect(lifted.components.get(ShipComponent)?.id).toBe(PRIZE);
            expect(lifted.components.get(CreditsComponent)?.credits).toBe(5_000);
            expect(lifted.components.get(StoredShipsComponent)
                ?.map(stored => stored.ship)).toEqual([STORED]);
            expect(lifted.components.get(MultiplayerData))
                .toEqual({ owner: 'peer-1' });
        });
});
