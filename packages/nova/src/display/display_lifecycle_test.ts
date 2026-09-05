import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { TimePlugin } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
import { CargoComponent } from '../nova_plugin/cargo_plugin.js';
import { ControlEvent, ControlsSubject } from '../nova_plugin/controls_plugin.js';
import {
    DisplayAssetDataResource, SimulationGameDataResource,
} from '../nova_plugin/game_data_resource.js';
import { ActiveRanksComponent, ControlBitsComponent } from '../nova_plugin/ncb_plugin.js';
import { OutfitsStateComponent } from '../nova_plugin/outfit_plugin.js';
import { PlanetComponent } from '../nova_plugin/planet_plugin.js';
import {
    CreditsComponent, GameDateComponent, MissionsComponent,
} from '../nova_plugin/player_state_plugin.js';
import { ShipComponent } from '../nova_plugin/ship_plugin.js';
import { SystemIdResource } from '../nova_plugin/system_id_resource.js';
import { installHeadlessPixi } from '../spaceport/headless_pixi_fixture.js';
import { MenuControls } from '../spaceport/menu_controls.js';
import { MissionUniverse } from '../spaceport/mission_universe.js';
import { BoardingDisplayPlugin } from './boarding_plugin.js';
import { CursorPlugin } from './cursor_plugin.js';
import { GateMapPlugin } from './gate_map_plugin.js';
import { HailDialogPlugin } from './hail_dialog_plugin.js';
import { MissionInfoPlugin, OpenMissionInfoResource } from './mission_info_plugin.js';
import { MissionShipDonePlugin } from './mission_ship_done_plugin.js';
import { PixiAppResource } from './pixi_app_resource.js';
import { PlanetCornersPlugin } from './planet_corners_plugin.js';
import { OpenPlayerInfoResource, PlayerInfoPlugin } from './player_info_plugin.js';
import { DisplayScaleResource, ScreenSize } from './screen_size_plugin.js';
import { ShipMissionOfferPlugin } from './ship_mission_offer_plugin.js';
import { CameraFocus, Space } from './space_resource.js';
import {
    LeaveSpaceportEvent, OpenSpaceportEvent, SpaceportPlugin,
} from './spaceport_plugin.js';
import { Stage } from './stage_resource.js';
import { OpenStarmapResource, StarmapPlugin } from './starmap_plugin.js';
import { StatusBarPlugin } from './status_bar.js';
import { StatusMessagePlugin } from './status_message_plugin.js';
import { TargetCornersPlugin } from './target_corners_plugin.js';

/**
 * ============================================================================
 * THE DISPLAY WORLD'S UI IS BUILT ON DEMAND AND DIES WITH THE WORLD
 * ============================================================================
 *
 * A display world is built at every jump or gate transit and torn down at
 * the next. Two things about what that costs (full-review findings #39 and
 * #40):
 *
 *  1. SPACEPORTS ARE BUILT ONLY WHERE THE PLAYER LANDS. The spaceport plugin
 *     used to `Provide` a full Spaceport — outfitter, shipyard, trade center,
 *     bar, mission board; a couple of thousand PIXI.Text canvases each — for
 *     EVERY stellar in the system the moment the world was built, unlandable
 *     ones (Jupiter, gates, wormholes) included, and destroy the lot at the
 *     next jump. Now one is built on the first landing at a stellar, kept
 *     for a second landing there, and destroyed with the world.
 *
 *  2. EVERY UI OBJECT A PLUGIN BUILDS IS DESTROYED WHEN IT IS REMOVED. Each
 *     PIXI.Text owns a canvas texture registered in PIXI's process-wide
 *     TextureCache (once rendered, a GPU texture too), so a dialog that is
 *     merely `removeChild`ed at teardown leaks its Texts for the rest of the
 *     session — per transit, unbounded. The dialogs, popups, maps, status
 *     bar, status line, corner reticles and cursor all `destroy({ children:
 *     true })` now. Shared textures (PICTs, cicns, spritesheet frames from
 *     the asset cache) are NOT destroyed: Sprite.destroy leaves its texture
 *     alone unless told otherwise, and only Text destroys its own.
 *
 * Both are pinned by counting PIXI's TextureCache — exactly the thing that
 * leaked — and by checking `destroyed` on every object the plugins put under
 * the stage. Headless: the fixture's stub canvas lets Text exist, and the
 * asset layer hands out empty sprites/textures, so nothing here measures how
 * anything looks.
 */
describe('display world UI lifecycle', () => {
    beforeAll(() => installHeadlessPixi());

    /** How many textures PIXI is holding process-wide. */
    const cachedTextures = () => Object.keys(PIXI.utils.TextureCache).length;

    /** Lets in-flight async builds (data reads, universe loads) finish. */
    async function settle(turns = 40) {
        for (let i = 0; i < turns; i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    /** Spins the event loop until `ready` holds (or the spec gives up). */
    async function waitFor(ready: () => boolean, what: string) {
        for (let i = 0; i < 2000 && !ready(); i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        expect(ready()).withContext(what).toBe(true);
    }

    /** Every display object under `root`, depth first. */
    function descendants(root: PIXI.Container): PIXI.DisplayObject[] {
        const out: PIXI.DisplayObject[] = [];
        const walk = (node: PIXI.DisplayObject) => {
            out.push(node);
            for (const child of (node as PIXI.Container).children ?? []) {
                walk(child);
            }
        };
        for (const child of root.children) {
            walk(child);
        }
        return out;
    }

    /**
     * The real game data behind an asset layer that never touches a canvas
     * or the network: PICT/cicn/ppat requests get empty sprites/textures
     * (PIXI.Texture.EMPTY is a shared singleton and is never destroyed by
     * a Sprite's default destroy), and the cursor's spritesheet has no
     * frames, so `Texture.from(url)` — which would try to load an image —
     * is never reached.
     */
    async function assets() {
        const gameData = await getIntegrationGameData();
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
        return { gameData, displayAssets };
    }

    /**
     * A display world with everything the UI plugins read, and the two
     * containers they add themselves to (the UI `Stage` and the in-world
     * `Space`), but no renderer: the status bar only keeps the renderer
     * for a target it never gets, and the cursor only asks it to hide the
     * OS pointer.
     */
    async function displayWorld() {
        const { gameData, displayAssets } = await assets();
        const world = new World();
        world.resources.set(SimulationGameDataResource, gameData);
        world.resources.set(DisplayAssetDataResource, displayAssets);
        world.resources.set(ControlsSubject, new Subject<ControlEvent>());
        world.resources.set(SystemIdResource, (await gameData.ids).System[0]);
        world.resources.set(PixiAppResource, {
            renderer: { events: { cursorStyles: {} } }, view: {},
        } as unknown as PIXI.Application);
        world.resources.set(Stage, new PIXI.Container());
        world.resources.set(Space, new PIXI.Container());
        world.resources.set(ScreenSize, { x: 1920, y: 1080 });
        world.resources.set(DisplayScaleResource, { ui: 1, global: 1 });
        world.resources.set(CameraFocus, { x: 0, y: 0 });
        await world.addPlugin(TimePlugin);
        return world;
    }

    describe('spaceports (review #39)', () => {
        const controls = () => new Subject<ControlEvent>();

        /**
         * The spaceport plugin alone, over a system of `planetIds`, with
         * the overlay openers it hands each spaceport stubbed out.
         */
        async function spaceportWorld(planetIds: string[]) {
            const world = await displayWorld();
            world.resources.set(ControlsSubject, controls());
            world.resources.set(OpenStarmapResource, async () => []);
            world.resources.set(OpenPlayerInfoResource, async () => undefined);
            world.resources.set(OpenMissionInfoResource, async () => undefined);
            for (const id of planetIds) {
                world.entities.set(`planet ${id}`,
                    new Entity().addComponent(PlanetComponent, { id }));
            }
            await world.addPlugin(SpaceportPlugin);
            return world;
        }

        const spaceportsOn = (world: World) =>
            world.resources.get(Stage)!.children
                .filter(child => child.name === 'Spaceport').length;

        /** A pilot with enough aboard for the landing bookkeeping. */
        function pilot(shipId: string) {
            return new Entity('pilot')
                .addComponent(ShipComponent, { id: shipId })
                .addComponent(CreditsComponent, { credits: 10_000 })
                .addComponent(OutfitsStateComponent, new Map())
                .addComponent(CargoComponent, new Map())
                .addComponent(ControlBitsComponent, new Set<number>())
                .addComponent(ActiveRanksComponent, new Set<string>())
                .addComponent(MissionsComponent, new Map())
                .addComponent(GameDateComponent,
                    { day: 1, month: 1, year: 1177 });
        }

        it('builds nothing at system entry, one spaceport on the first '
            + 'landing, and frees it with the world', async () => {
                const gameData = await getIntegrationGameData();
                // The five-stellar systems (Sol, Aldebaran, Aurora, K-003)
                // are the worst case; any five stellars reproduce the
                // count, and what matters is that none is built for free.
                const ids = await gameData.ids;
                const planets = ids.Planet.slice(0, 5);
                const shipId = ids.Ship[0];
                await MissionUniverse.shared(gameData).load();

                const before = cachedTextures();
                const world = await spaceportWorld(planets);
                world.step();
                await settle();
                // Entering the system built no venue at all: not one
                // Text canvas, not one spaceport frame on the stage.
                expect(spaceportsOn(world)).toBe(0);
                expect(cachedTextures()).toBe(before);

                // Landing at the second stellar builds ITS spaceport and
                // nobody else's.
                const landedAt = planets[1];
                let left = 0;
                world.events.get(LeaveSpaceportEvent).subscribe(() => left++);
                world.emit(OpenSpaceportEvent,
                    { planetId: landedAt, ship: pilot(shipId) });
                world.step();
                expect(spaceportsOn(world)).toBe(1);
                const spaceport = world.resources.get(Stage)!.children
                    .find(child => child.name === 'Spaceport')!;
                expect(cachedTextures()).toBeGreaterThan(before);
                const builtForOne = cachedTextures() - before;

                // The landing sequence (mission bookkeeping, the landing
                // popups) has to run out before the spaceport's own keys
                // mean anything; then Leave hands the ship back.
                await settle(100);
                const keys = world.resources.get(ControlsSubject)!;
                await waitFor(() => {
                    keys.next({ action: 'depart', state: 'start' });
                    world.step();
                    return left > 0 && MenuControls.focused === undefined;
                }, 'the spaceport let the pilot leave');

                // A second landing at the same stellar reuses it; landing
                // elsewhere builds a second one.
                world.emit(OpenSpaceportEvent,
                    { planetId: landedAt, ship: pilot(shipId) });
                world.step();
                expect(spaceportsOn(world)).toBe(1);
                await settle(100);
                await waitFor(() => {
                    keys.next({ action: 'depart', state: 'start' });
                    world.step();
                    return left > 1 && MenuControls.focused === undefined;
                }, 'the spaceport let the pilot leave again');
                world.emit(OpenSpaceportEvent,
                    { planetId: planets[3], ship: pilot(shipId) });
                world.step();
                expect(spaceportsOn(world)).toBe(2);
                expect(cachedTextures() - before)
                    .toBeGreaterThanOrEqual(2 * builtForOne);
                await settle(100);
                await waitFor(() => {
                    keys.next({ action: 'depart', state: 'start' });
                    world.step();
                    return left > 2 && MenuControls.focused === undefined;
                }, 'the second spaceport let the pilot leave');

                // The transit destroys both, canvases and all.
                await world.removePlugin(SpaceportPlugin);
                expect(spaceport.destroyed).toBe(true);
                expect(spaceportsOn(world)).toBe(0);
                expect(cachedTextures()).toBe(before);
            });

        it('ignores a landing at a stellar the world does not have',
            async () => {
                const gameData = await getIntegrationGameData();
                const ids = await gameData.ids;
                const world = await spaceportWorld(ids.Planet.slice(0, 2));
                world.emit(OpenSpaceportEvent,
                    { planetId: 'nova:99999', ship: pilot(ids.Ship[0]) });
                world.step();
                expect(spaceportsOn(world)).toBe(0);
                await world.removePlugin(SpaceportPlugin);
            });
    });

    describe('plugin teardown (review #40)', () => {
        /**
         * The UI plugins that build PIXI objects in build() and used to only
         * detach them in remove(), in display_plugin.ts's build order...
         */
        const uiPlugins = [
            StatusBarPlugin, StatusMessagePlugin, TargetCornersPlugin,
            PlanetCornersPlugin, StarmapPlugin, PlayerInfoPlugin,
            MissionInfoPlugin, ShipMissionOfferPlugin, MissionShipDonePlugin,
            HailDialogPlugin, SpaceportPlugin, BoardingDisplayPlugin,
            GateMapPlugin, CursorPlugin,
        ];
        /** ...and in its remove order. */
        const removeOrder = [
            CursorPlugin, GateMapPlugin, BoardingDisplayPlugin,
            SpaceportPlugin, HailDialogPlugin, MissionShipDonePlugin,
            ShipMissionOfferPlugin, MissionInfoPlugin, PlayerInfoPlugin,
            StarmapPlugin, PlanetCornersPlugin, TargetCornersPlugin,
            StatusBarPlugin, StatusMessagePlugin,
        ];

        /** One system transit's worth of display world: build, then tear
         * down. Returns what was on the stage and in space in between. */
        async function transit() {
            const world = await displayWorld();
            for (const plugin of uiPlugins) {
                await world.addPlugin(plugin);
            }
            await settle();
            const built = [
                ...descendants(world.resources.get(Stage)!),
                ...descendants(world.resources.get(Space)!),
            ];
            for (const plugin of removeOrder) {
                await world.removePlugin(plugin);
            }
            await settle();
            return built;
        }

        it('destroys every object the UI plugins built, so N transits '
            + 'leave PIXI\'s texture cache where it started', async () => {
                const gameData = await getIntegrationGameData();
                // Warm the shared caches (the mission universe, the
                // parsed systems the starmap reads) so the measured
                // transits are not racing their own first data reads.
                await MissionUniverse.shared(gameData).load();
                await transit();

                const before = cachedTextures();
                const transits = 3;
                for (let i = 0; i < transits; i++) {
                    const built = await transit();
                    // Sanity: this really is the UI. Texts are the leak
                    // that mattered, so there had better be plenty.
                    const texts = built.filter(o => o instanceof PIXI.Text);
                    expect(texts.length).withContext('texts built')
                        .toBeGreaterThan(50);
                    const survivors = built.filter(o => !o.destroyed);
                    expect(survivors.length)
                        .withContext('objects not destroyed after '
                            + `transit ${i}: ` + survivors.slice(0, 10)
                                .map(o => `${o.constructor.name}`
                                    + `(${o.name ?? ''})`).join(', '))
                        .toBe(0);
                }
                // Before the fix this grew by every Text the dialogs,
                // maps, status bar and popups had built — per transit.
                expect(cachedTextures() - before)
                    .withContext(`textures leaked over ${transits} transits`)
                    .toBe(0);
            });
    });
});
