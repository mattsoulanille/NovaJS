import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { TimePlugin } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { getSyntheticGameData } from '../communication/simulation_test_fixture.js';
import {
    ControlEvent, ControlsSubject, DisplayAssetDataResource,
    SimulationGameDataResource,
} from '../nova_plugin/core/index.js';
import {
    ActiveMission, GameDateComponent, MissionsComponent, PlayerShipSelector,
} from '../nova_plugin/player/index.js';
import { installHeadlessPixi } from '../spaceport/headless_pixi_fixture.js';
import { MenuControls } from '../spaceport/menu_controls.js';
import { NO_MISSIONS } from '../spaceport/mission_info.js';
import { MissionUniverse } from '../spaceport/mission_universe.js';
import type { AbortedMission } from '../nova_plugin/missions/index.js';
import { BITS } from 'novaparse/synthetic/universe';
import { ControlBitsComponent } from '../nova_plugin/ncb/index.js';
import { ShipComponent } from '../nova_plugin/ship/index.js';
import {
    AbortMissionEvent, MissionInfoPlugin, MissionInfoResource,
    OpenMissionInfoResource,
} from './mission_info_plugin.js';
import { ScreenSize } from './screen_size_plugin.js';
import { Stage } from './stage_resource.js';
import { StatusLineResource } from './status_message_plugin.js';

/**
 * In-flight 'i' against the original's wave-11 UI key matrix
 * (docs/reference_experiments.md): with no mission to list the original
 * prints "You have no active missions." on the status line and opens no
 * dialog; with one it opens "Currently active missions".
 */
describe('in-flight mission info key (wave 11)', () => {
    beforeAll(() => installHeadlessPixi());

    function active(id: string): ActiveMission {
        return {
            id, acceptedDay: 1, acceptedAt: SYNTHETIC.planets.port,
            travelPlanet: null, returnPlanet: SYNTHETIC.planets.port,
            cargoType: -1, cargoQty: 0, cargoLoaded: false, travelDone: false,
            deadlineDay: null,
        };
    }

    async function flight(missions: [string, ActiveMission][]) {
        const gameData = await getSyntheticGameData();
        const displayAssets = {
            data: gameData.data,
            spriteFromPict: () => new PIXI.Sprite(),
            spriteFromPictAsync: async () => new PIXI.Sprite(),
            textureFromPict: () => PIXI.Texture.EMPTY,
            textureFromPictAsync: async () => PIXI.Texture.EMPTY,
            textureFromCicn: async () => PIXI.Texture.EMPTY,
            textureFromPpat: async () => PIXI.Texture.EMPTY,
        } as unknown as DisplayAssetDataInterface;
        const world = new World();
        const controls = new Subject<ControlEvent>();
        const lines: string[] = [];
        world.resources.set(SimulationGameDataResource, gameData);
        world.resources.set(DisplayAssetDataResource, displayAssets);
        world.resources.set(ControlsSubject, controls);
        world.resources.set(Stage, new PIXI.Container());
        world.resources.set(ScreenSize, { x: 1920, y: 1080 });
        world.resources.set(StatusLineResource, {
            setMessage: (message: string) => lines.push(message),
        } as never);
        await world.addPlugin(TimePlugin);
        await world.addPlugin(MissionInfoPlugin);
        world.entities.set('player', new Entity()
            .addComponent(PlayerShipSelector, undefined)
            .addComponent(ShipComponent, { id: SYNTHETIC.ships.skiff })
            .addComponent(MissionsComponent, new Map(missions))
            .addComponent(GameDateComponent, { day: 1, month: 1, year: 1177 }));
        const dialog = world.resources.get(MissionInfoResource)!;
        const pressI = () => controls.next({ action: 'missions', state: 'start' });
        const aborts: AbortedMission[] = [];
        world.events.get(AbortMissionEvent).subscribe(({ data }) =>
            aborts.push(data.record));
        return { world, lines, dialog, pressI, aborts };
    }

    async function settle(turns = 200) {
        for (let i = 0; i < turns; i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    afterEach(() => {
        expect(MenuControls.focused).withContext('focus stack')
            .toBeUndefined();
    });

    it('prints the status line, not a dialog, with no missions', async () => {
        const { lines, dialog, pressI } = await flight([]);
        pressI();
        await settle();
        expect(dialog.container.visible).toBeFalse();
        expect(lines).toEqual([NO_MISSIONS]);
    });

    it('counts an invisible mission as none (it is never listed)', async () => {
        const rescue = SYNTHETIC.missions.rescue;
        const { lines, dialog, pressI } =
            await flight([[rescue, active(rescue)]]);
        pressI();
        await settle();
        expect(dialog.container.visible).toBeFalse();
        expect(lines).toEqual([NO_MISSIONS]);
    });

    it('opens the dialog with a mission, and i closes it', async () => {
        const courier = SYNTHETIC.missions.courier;
        const { lines, dialog, pressI } =
            await flight([[courier, active(courier)]]);
        pressI();
        for (let i = 0; i < 2000 && !dialog.container.visible; i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        expect(dialog.container.visible).toBeTrue();
        expect(lines).toEqual([]);
        pressI();
        await settle();
        expect(dialog.container.visible).toBeFalse();
    });

    it('stands down while a landed menu holds the keyboard', async () => {
        const courier = SYNTHETIC.missions.courier;
        const { lines, dialog, pressI } =
            await flight([[courier, active(courier)]]);
        // The spaceport (or a venue) binds its controls on landing.
        const landed = new MenuControls(new Subject<ControlEvent>());
        landed.bind();
        pressI();
        await settle();
        expect(dialog.container.visible).toBeFalse();
        expect(lines).toEqual([]);
        landed.unbind();
    });

    /** The dialog's Abort button and description, from inside. */
    function parts(dialog: unknown) {
        return dialog as {
            abort: { state: string, click: { next(click: object): void } },
            description: { text: string },
        };
    }

    async function openWith(missions: [string, ActiveMission][]) {
        const flown = await flight(missions);
        flown.world.entities.get('player')!.components.set(
            ControlBitsComponent, new Set([BITS.courierAccepted]));
        flown.pressI();
        for (let i = 0; i < 2000 && !flown.dialog.container.visible; i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        expect(flown.dialog.container.visible).toBeTrue();
        return flown;
    }

    it('aborts in flight through an abortMission record', async () => {
        const courier = SYNTHETIC.missions.courier;
        const { dialog, aborts } =
            await openWith([[courier, active(courier)]]);
        const { abort } = parts(dialog);
        expect(abort.state).withContext('Abort is live in flight')
            .toBe('normal');
        abort.click.next({});
        for (let i = 0; i < 2000 && aborts.length === 0; i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        expect(aborts).toEqual([{
            missionId: courier, bitsCleared: [BITS.courierAccepted],
        }]);
        // The WHOLE dialog closes at once, no confirmation, without
        // waiting for the simulation (reference "Aborting a mission in
        // flight from the `i` dialog, wave 13").
        await settle();
        expect(dialog.container.visible).toBeFalse();
    });

    it('sends a deferred auto-abort the moment the sim marks it, once '
        + '(reference "The deferred (përs) auto-abort (R16), wave 43")',
        async () => {
            const courier = SYNTHETIC.missions.courier;
            const { world, aborts, dialog } =
                await flight([[courier, active(courier)]]);
            world.entities.get('player')!.components.set(
                ControlBitsComponent, new Set([BITS.courierAccepted]));
            world.step();
            await settle();
            expect(aborts).toEqual([]);
            // The board: rescueBoarded marks it on the owner's list.
            world.entities.get('player')!.components.get(MissionsComponent)!
                .get(courier)!.autoAbortPending = true;
            for (let i = 0; i < 2000 && aborts.length === 0; i++) {
                world.step();
                await new Promise(resolve => setTimeout(resolve, 0));
            }
            expect(aborts).toEqual([{
                missionId: courier, bitsCleared: [BITS.courierAccepted],
            }]);
            // No dialog ("Target ship has been boarded." and nothing
            // else), and not sent again while the record is on its way.
            expect(dialog.container.visible).toBeFalse();
            for (let i = 0; i < 20; i++) {
                world.step();
            }
            await settle();
            expect(aborts.length).toBe(1);
        });

    describe('docked (the spaceport\'s i)', () => {
        function docked(missions: [string, ActiveMission][]) {
            // The hull the spaceport holds: out of the world.
            return new Entity()
                .addComponent(ShipComponent, { id: SYNTHETIC.ships.skiff })
                .addComponent(MissionsComponent, new Map(missions))
                .addComponent(GameDateComponent,
                    { day: 1, month: 1, year: 1177 })
                .addComponent(ControlBitsComponent,
                    new Set([BITS.courierAccepted]));
        }

        it('does nothing at all with no missions (wave 11)', async () => {
            const { world, lines, dialog } = await flight([]);
            await world.resources.get(OpenMissionInfoResource)!(docked([]));
            await settle();
            expect(dialog.container.visible).toBeFalse();
            expect(lines).toEqual([]);
        });

        it('opens for the docked hull, and Abort takes the docked path '
            + '(reference "#324 mission BBS after an accept, wave 21")',
            async () => {
                const courier = SYNTHETIC.missions.courier;
                const { world, lines, dialog, aborts } = await flight([]);
                const asked: string[] = [];
                const closed = world.resources.get(OpenMissionInfoResource)!(
                    docked([[courier, active(courier)]]),
                    async id => { asked.push(id); return true; });
                for (let i = 0; i < 2000 && !dialog.container.visible; i++) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
                expect(dialog.container.visible).toBeTrue();
                expect(lines).toEqual([]);
                const { abort } = parts(dialog);
                expect(abort.state).toBe('normal');
                abort.click.next({});
                await closed;
                expect(asked).toEqual([courier]);
                // Not the in-flight record: the landing owns this one.
                expect(aborts).toEqual([]);
                expect(dialog.container.visible).toBeFalse();
            });
    });

    it('greys Abort for a CanAbort 0 mission', async () => {
        const courier = SYNTHETIC.missions.courier;
        const original = MissionUniverse.prototype.getMission;
        spyOn(MissionUniverse.prototype, 'getMission').and.callFake(
            function (this: MissionUniverse, id: string) {
                const mission = original.call(this, id);
                return mission && id === courier
                    ? { ...mission, canAbort: false } : mission;
            });
        const { dialog, aborts, pressI } =
            await openWith([[courier, active(courier)]]);
        const { abort } = parts(dialog);
        expect(abort.state).toBe('grey');
        abort.click.next({});
        await settle();
        expect(aborts).toEqual([]);
        pressI();
        await settle();
    });
});
