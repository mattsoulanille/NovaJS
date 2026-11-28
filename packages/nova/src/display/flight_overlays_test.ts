import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { TimePlugin } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { getSyntheticGameData } from '../communication/simulation_test_fixture.js';
import { isTextEntryActive } from '../input_focus.js';
import {
    ControlAction, ControlEvent, ControlsSubject, DisplayAssetDataResource,
    SimulationGameDataResource, SystemIdResource,
} from '../nova_plugin/core/index.js';
import { ActiveRanksComponent, ControlBitsComponent } from '../nova_plugin/ncb/index.js';
import {
    ActiveMission, CreditsComponent, DiscoveryStore, DiscoveryStoreResource,
    GameDateComponent, MissionsComponent, PlayerShipSelector,
} from '../nova_plugin/player/index.js';
import {
    CargoComponent, OutfitsStateComponent, ShipComponent,
} from '../nova_plugin/ship/index.js';
import { PlanetComponent } from '../nova_plugin/travel/index.js';
import { installHeadlessPixi } from '../spaceport/headless_pixi_fixture.js';
import { MenuControls } from '../spaceport/menu_controls.js';
import { MissionUniverse } from '../spaceport/mission_universe.js';
import { PopupChoice } from '../spaceport/offer_popup.js';
import { FlightOverlaysResource } from './flight_overlays.js';
import {
    GateMapPlugin, LeaveGateMapEvent, OpenGateMapEvent,
} from './gate_map_plugin.js';
import { HailDialogPlugin, HailDialogResource } from './hail_dialog_plugin.js';
import {
    MissionInfoPlugin, MissionInfoResource,
} from './mission_info_plugin.js';
import {
    MissionShipDonePlugin, ShipDonePopupResource,
} from './mission_ship_done_plugin.js';
import { PixiAppResource } from './pixi_app_resource.js';
import { PlayerInfoPlugin, PlayerInfoResource } from './player_info_plugin.js';
import { DisplayScaleResource, ScreenSize } from './screen_size_plugin.js';
import {
    ShipMissionOfferPlugin, ShipOfferPopupResource,
} from './ship_mission_offer_plugin.js';
import { CameraFocus, Space } from './space_resource.js';
import {
    LeaveSpaceportEvent, OpenSpaceportEvent, SpaceportComponent,
    SpaceportPlugin,
} from './spaceport_plugin.js';
import { Stage } from './stage_resource.js';
import { StatusLineResource } from './status_message_plugin.js';
import {
    MiniMapResource, StarmapPlugin, StarmapResource,
} from './starmap_plugin.js';

/**
 * ============================================================================
 * A DOCKING CLOSES WHAT WAS OPEN OVER SPACE, AND EVERY KEY STILL WORKS AFTER
 * ============================================================================
 *
 * Matthew, 2026-11-27: "If I land with the map open (via the auto-lander),
 * I can't open my map when on the planet." The autopilot taps `land`
 * through the control sinks, so it lands with the full map up; a landing
 * keeps the display world (only a jump rebuilds it), so the map stayed
 * open UNDER the spaceport — bound below it on the focus stack, and
 * "already open" to its opener, which then refused the spaceport's `m`.
 * The same held for mission info (`i`), player info (`p`), the hail
 * channel and the in-flight popups. Docking now closes them all through
 * one path (display/flight_overlays.ts); these walk each one through a
 * landing and a lift-off with the real plugins, and check its key opens
 * it again on the planet and back in flight.
 */
describe('in-flight overlays at a docking', () => {
    beforeAll(() => installHeadlessPixi());

    afterEach(() => {
        expect(MenuControls.focused).withContext('focus stack at the end')
            .toBeUndefined();
        expect(isTextEntryActive()).withContext('text entry at the end')
            .toBeFalse();
    });

    async function settle(turns = 40) {
        for (let i = 0; i < turns; i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    async function waitFor(ready: () => boolean, what: string) {
        for (let i = 0; i < 3000 && !ready(); i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        expect(ready()).withContext(what).toBe(true);
    }

    /** A listed mission (so `i` opens a dialog) that does not end at the
     * port the specs land at (so the landing raises no popup). */
    function courier(): [string, ActiveMission] {
        const id = SYNTHETIC.missions.courier;
        return [id, {
            id, acceptedDay: 1, acceptedAt: SYNTHETIC.planets.port,
            travelPlanet: null, returnPlanet: SYNTHETIC.planets.refuge,
            cargoType: -1, cargoQty: 0, cargoLoaded: false, travelDone: false,
            deadlineDay: null,
        }];
    }

    /**
     * A display world in Thessaly Reach with every in-flight overlay's
     * plugin, the spaceport and the gate map, and the player's ship in it.
     */
    async function flight() {
        const gameData = await getSyntheticGameData();
        await MissionUniverse.shared(gameData).load();
        const displayAssets = {
            data: {
                ...gameData.data,
                SpriteSheetFrames: { get: async () => ({ frames: {} }) },
            },
            spriteFromPict: () => new PIXI.Sprite(),
            spriteFromPictAsync: async () => new PIXI.Sprite(),
            textureFromPict: () => PIXI.Texture.EMPTY,
            textureFromPictAsync: async () => PIXI.Texture.EMPTY,
            textureFromCicn: async () => PIXI.Texture.EMPTY,
            textureFromPpat: async () => PIXI.Texture.EMPTY,
        } as unknown as DisplayAssetDataInterface;
        const world = new World();
        const keys = new Subject<ControlEvent>();
        world.resources.set(SimulationGameDataResource, gameData);
        world.resources.set(DisplayAssetDataResource, displayAssets);
        world.resources.set(ControlsSubject, keys);
        world.resources.set(SystemIdResource, SYNTHETIC.systems.thessaly);
        world.resources.set(DiscoveryStoreResource, new DiscoveryStore());
        world.resources.set(PixiAppResource, {
            renderer: { events: { cursorStyles: {} } }, view: {},
        } as unknown as PIXI.Application);
        world.resources.set(Stage, new PIXI.Container());
        world.resources.set(Space, new PIXI.Container());
        world.resources.set(ScreenSize, { x: 1920, y: 1080 });
        world.resources.set(DisplayScaleResource, { ui: 1, global: 1 });
        world.resources.set(CameraFocus, { x: 0, y: 0 });
        world.resources.set(StatusLineResource, {
            setMessage: () => undefined,
        } as never);
        await world.addPlugin(TimePlugin);
        for (const plugin of [StarmapPlugin, MissionInfoPlugin,
            PlayerInfoPlugin, HailDialogPlugin, ShipMissionOfferPlugin,
            MissionShipDonePlugin, SpaceportPlugin, GateMapPlugin]) {
            await world.addPlugin(plugin);
        }
        world.entities.set('port', new Entity()
            .addComponent(PlanetComponent, { id: SYNTHETIC.planets.port }));
        const ship = new Entity('pilot')
            .addComponent(PlayerShipSelector, undefined)
            .addComponent(ShipComponent, { id: SYNTHETIC.ships.skiff })
            .addComponent(CreditsComponent, { credits: 10_000 })
            .addComponent(OutfitsStateComponent, new Map())
            .addComponent(CargoComponent, new Map())
            .addComponent(ControlBitsComponent, new Set<number>())
            .addComponent(ActiveRanksComponent, new Set<string>())
            .addComponent(MissionsComponent, new Map([courier()]))
            .addComponent(GameDateComponent,
                { day: 1, month: 1, year: 1177 });
        world.entities.set('player', ship);
        world.step();
        await settle();

        const press = (action: ControlAction) => {
            keys.next({ action, state: 'start' });
            keys.next({ action, state: false });
        };
        const starmap = world.resources.get(StarmapResource)!;
        const missionInfo = world.resources.get(MissionInfoResource)!;
        const playerInfo = world.resources.get(PlayerInfoResource)!;
        let left = 0;
        world.events.get(LeaveSpaceportEvent).subscribe(() => left++);

        /** The client's landing: the ship leaves the world, the spaceport
         * opens (client/docking.ts runDockingFrame). */
        const land = () => {
            world.entities.delete('player');
            world.emit(OpenSpaceportEvent,
                { planetId: SYNTHETIC.planets.port, ship, uuid: 'player' });
            world.step();
            return world.entities.get('port')!
                .components.get(SpaceportComponent)!;
        };
        /** Waits for the spaceport's main screen, presses Leave until it
         * lets go, and puts the ship back in the world (the lift-off). */
        const leave = async () => {
            const before = left;
            await waitFor(() => {
                press('depart');
                world.step();
                return left > before && MenuControls.focused === undefined;
            }, 'the spaceport let the pilot leave');
            world.entities.set('player', ship);
            world.step();
        };
        return {
            world, ship, press, land, leave, starmap, missionInfo,
            playerInfo,
        };
    }

    /** The overlay's key opens it in flight; it is open at a landing; on
     * the planet its key opens it over the spaceport and closes it again;
     * after the lift-off its key opens it in flight again. */
    async function walk(key: ControlAction,
        container: (f: Awaited<ReturnType<typeof flight>>) => PIXI.Container,
        name: string) {
        const f = await flight();
        const shown = () => container(f).visible;
        f.press(key);
        await waitFor(shown, `${name} opened in flight`);
        expect(MenuControls.focused).toBeDefined();

        const spaceport = f.land();
        await settle();
        expect(shown()).withContext(`${name} closed by the landing`)
            .toBeFalse();
        await waitFor(() => spaceport.onMainScreen,
            'the spaceport reached its main screen');

        // The key works on the planet...
        f.press(key);
        await waitFor(shown, `${name} opened on the planet`);
        // ...and closes it back to the spaceport.
        f.press(key);
        await waitFor(() => !shown() && spaceport.onMainScreen,
            `${name} closed back to the spaceport`);

        await f.leave();
        f.press(key);
        await waitFor(shown, `${name} opened after the lift-off`);
        f.press(key);
        await waitFor(() => !shown() && MenuControls.focused === undefined,
            `${name} closed in flight`);
    }

    it('m: the full map, landed with it open (the autopilot case)',
        () => walk('map', f => f.starmap.container, 'the map'));

    it('i: mission info, landed with it open',
        () => walk('missions', f => f.missionInfo.container,
            'mission info'));

    it('p: player info, landed with it open',
        () => walk('properties', f => f.playerInfo.container,
            'player info'));

    it('h: the minimap peek ends at the landing and runs again after',
        async () => {
            const f = await flight();
            const miniMap = f.world.resources.get(MiniMapResource)!.miniMap;
            f.press('smallMap');
            expect(miniMap.showing).toBeTrue();
            const spaceport = f.land();
            expect(miniMap.showing).toBeFalse();
            await waitFor(() => spaceport.onMainScreen,
                'the spaceport reached its main screen');
            // In the bar, `h` is Hire: no peek on the planet.
            f.press('smallMap');
            expect(miniMap.showing).toBeFalse();
            await f.leave();
            f.press('smallMap');
            expect(miniMap.showing).toBeTrue();
        });

    it('m: an open still loading at the landing never binds over the '
        + 'spaceport', async () => {
            const f = await flight();
            // Pressed, then landed in the same turn: the map's show() is
            // still awaiting its (cached) data when the landing closes it.
            f.press('map');
            expect(f.starmap.container.visible).toBeFalse();
            const spaceport = f.land();
            await settle();
            expect(f.starmap.container.visible)
                .withContext('the open was called off').toBeFalse();
            await waitFor(() => spaceport.onMainScreen, 'main screen');
            f.press('map');
            await waitFor(() => f.starmap.container.visible,
                'the map opened on the planet');
            f.press('map');
            await waitFor(() => spaceport.onMainScreen, 'map closed');
            await f.leave();
        });

    it('m: the map\'s Find dialog goes with it, keyboard and all',
        async () => {
            const f = await flight();
            f.press('map');
            await waitFor(() => f.starmap.container.visible, 'map opened');
            // `f` (the escorts' attack key) opens Find over the map.
            f.press('attack');
            await waitFor(() => isTextEntryActive(), 'Find took the keys');
            const spaceport = f.land();
            await settle();
            expect(isTextEntryActive()).toBeFalse();
            expect(f.starmap.container.visible).toBeFalse();
            await waitFor(() => spaceport.onMainScreen, 'main screen');
            await f.leave();
        });

    it('m: a jump with Find up over the map gives every key back',
        async () => {
            const f = await flight();
            f.press('map');
            await waitFor(() => f.starmap.container.visible, 'map opened');
            f.press('attack');
            await waitFor(() => isTextEntryActive(), 'Find took the keys');
            // The transit: the world's plugins are removed.
            await f.world.removePlugin(SpaceportPlugin);
            await f.world.removePlugin(StarmapPlugin);
            await settle();
            expect(isTextEntryActive()).toBeFalse();
            expect(MenuControls.focused).toBeUndefined();
        });

    it('closes a hail channel at the landing, and it opens again after',
        async () => {
            const f = await flight();
            const dialog = f.world.resources.get(HailDialogResource)!;
            const context = {
                variant: 'ship' as const, heading: 'Pirate Viper',
                image: null, body: 'Channel open.',
            };
            let closed = false;
            void dialog.show(context).then(() => { closed = true; });
            await waitFor(() => dialog.container.visible, 'channel open');
            const spaceport = f.land();
            await settle();
            expect(closed).withContext('the channel closed').toBeTrue();
            expect(dialog.container.visible).toBeFalse();
            await waitFor(() => spaceport.onMainScreen, 'main screen');
            await f.leave();
            // Not torn down: the same dialog opens again in flight.
            const again = dialog.show(context);
            await waitFor(() => dialog.container.visible
                && MenuControls.focused !== undefined, 'channel reopened');
            dialog.withdraw();
            await again;
        });

    it('calls off a hail channel still rendering at the landing',
        async () => {
            const f = await flight();
            const dialog = f.world.resources.get(HailDialogResource)!;
            const shown = dialog.show({
                variant: 'ship', heading: 'Pirate Viper', image: null,
                body: 'Channel open.',
            });
            const spaceport = f.land();
            await shown;
            await settle();
            expect(dialog.container.visible).toBeFalse();
            await waitFor(() => spaceport.onMainScreen, 'main screen');
            await f.leave();
        });

    it('withdraws a ship\'s offer and a ship-done text, unanswered',
        async () => {
            const f = await flight();
            for (const popup of [
                f.world.resources.get(ShipOfferPopupResource)!,
                f.world.resources.get(ShipDonePopupResource)!,
            ]) {
                let answer: PopupChoice | undefined;
                void popup.show('Will you carry the cargo?',
                    { accept: 'Accept', refuse: 'Refuse' })
                    .then(choice => { answer = choice; });
                expect(MenuControls.focused).toBeDefined();
                const spaceport = f.land();
                await settle();
                expect(answer).toBe('withdrawn');
                expect(popup.container.visible).toBeFalse();
                // An offer whose data was still loading at the landing
                // does not open over the spaceport either.
                expect(await popup.show('Late.', { accept: 'OK' }))
                    .toBe('withdrawn');
                await waitFor(() => spaceport.onMainScreen, 'main screen');
                await f.leave();
                // In flight again, the popup asks as before.
                const asked = popup.show('Again?', { accept: 'OK' });
                expect(popup.container.visible).toBeTrue();
                f.press('depart');
                expect(await asked).toBe('accept');
            }
        });

    it('closes the map at a hypergate dock; `m` works after the lift-off',
        async () => {
            const f = await flight();
            f.press('map');
            await waitFor(() => f.starmap.container.visible, 'map opened');
            const mapControls = MenuControls.focused;
            f.world.entities.delete('player');
            let lifted = false;
            f.world.events.get(LeaveGateMapEvent)
                .subscribe(() => { lifted = true; });
            f.world.emit(OpenGateMapEvent, {
                gateSpob: SYNTHETIC.planets.kestrelGate,
                systemId: SYNTHETIC.systems.kestrel, ship: f.ship,
            });
            f.world.step();
            await waitFor(() => !f.starmap.container.visible
                && MenuControls.focused !== undefined
                && MenuControls.focused !== mapControls,
                'the gate map took over from the closed map');
            // Done with no pick lifts back off.
            await waitFor(() => {
                f.press('depart');
                f.world.step();
                return lifted && MenuControls.focused === undefined;
            }, 'the gate map let go');
            f.world.entities.set('player', f.ship);
            f.world.step();
            f.press('map');
            await waitFor(() => f.starmap.container.visible,
                'the map opened after the gate lift-off');
            f.press('map');
            await waitFor(() => MenuControls.focused === undefined,
                'map closed');
        });

    it('registers every in-flight overlay, and unregisters each with its '
        + 'world', async () => {
            const f = await flight();
            const overlays = f.world.resources.get(FlightOverlaysResource)!;
            expect(overlays.names.sort()).toEqual([
                'hail channel', 'mission info', 'player info', 'ship offer',
                'ship-done text', 'star map',
            ]);
            for (const plugin of [GateMapPlugin, SpaceportPlugin,
                StarmapPlugin, MissionInfoPlugin, PlayerInfoPlugin,
                HailDialogPlugin, ShipMissionOfferPlugin,
                MissionShipDonePlugin]) {
                await f.world.removePlugin(plugin);
            }
            expect(overlays.names).toEqual([]);
        });
});
