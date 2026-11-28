import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultSystemData } from 'novadatainterface/system_data';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { ControlAction, ControlEvent } from '../nova_plugin/core/index.js';
import { FindDialog } from './find_dialog.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { Starmap } from './starmap.js';
import { overrideEnhancements } from '../enhancements.js';
import { PinchLevelStepper } from './starmap_gestures.js';
import {
    BASE_SCALE, DEFAULT_PX_PER_UNIT, DEFAULT_ZOOM, ORIGINAL_ZOOM_LEVELS,
    originalZoomStep, ZOOM_STEP,
} from './starmap_viewport.js';

/**
 * The map's zoom and Find keys (reference "Map keys, minimap routes and
 * ctrl-clicks (K4, M2, M3), wave 41"): `=` zooms in and `-` out, one step
 * each, the same step as the + / - buttons; `f` opens Find, which takes a
 * system name and centres and selects it.
 */
describe('star map keys (K4, wave 41)', () => {
    beforeAll(() => installHeadlessPixi());

    const HUB = 'nova:2140';
    const EAST = 'nova:2143';
    const FAR = 'nova:2146';

    function displayAssets(): DisplayAssetDataInterface {
        return {
            spriteFromPict: () => new PIXI.Sprite(),
            spriteFromPictAsync: async () => new PIXI.Sprite(),
            textureFromPict: () => PIXI.Texture.EMPTY,
            textureFromPictAsync: async () => PIXI.Texture.EMPTY,
            textureFromCicn: async () => PIXI.Texture.EMPTY,
            textureFromPpat: async () => PIXI.Texture.EMPTY,
            data: {},
        } as unknown as DisplayAssetDataInterface;
    }

    function gameData(): MockGameData {
        const data = new MockGameData();
        data.data.System.map.set(HUB, {
            ...getDefaultSystemData(), id: HUB, name: 'Map Hub',
            position: [-700, 400], links: [EAST],
        });
        data.data.System.map.set(EAST, {
            ...getDefaultSystemData(), id: EAST, name: 'Map East',
            position: [-660, 400], links: [HUB, FAR],
        });
        data.data.System.map.set(FAR, {
            ...getDefaultSystemData(), id: FAR, name: 'Map Far',
            position: [-580, 400], links: [EAST],
        });
        return data;
    }

    interface Internals {
        systemGraph?: { zoom: number };
        findDialog: FindDialog;
    }

    async function openMap() {
        const controls = new Subject<ControlEvent>();
        const starmap = new Starmap(displayAssets(),
            gameData() as unknown as SimulationGameDataInterface, HUB,
            controls);
        await starmap.buildPromise;
        const selected: string[] = [];
        const shown = starmap.show([]);
        await new Promise(resolve => setTimeout(resolve, 0));
        const internals = starmap as unknown as Internals;
        (internals.systemGraph as unknown as {
            infoSelection: Subject<string>,
        }).infoSelection.subscribe(id => selected.push(id));
        const press = (action: ControlAction) =>
            controls.next({ action, state: 'start' });
        const zoom = () => internals.systemGraph?.zoom ?? NaN;
        return { starmap, shown, internals, press, zoom, selected };
    }

    it('zooms one button step in on `=` and out on `-`', async () => {
        const { starmap, shown, press, zoom } = await openMap();
        expect(zoom()).toBeCloseTo(DEFAULT_ZOOM, 6);
        press('globalScaleUp');
        expect(zoom()).toBeCloseTo(DEFAULT_ZOOM * ZOOM_STEP ** 2, 6);
        press('globalScaleDown');
        press('globalScaleDown');
        expect(zoom()).toBeCloseTo(DEFAULT_ZOOM / ZOOM_STEP ** 2, 6);
        starmap.dismiss();
        await shown;
    });

    it('takes the same step as the - / + buttons', async () => {
        const { starmap, shown, zoom } = await openMap();
        const buttons = (starmap as unknown as {
            buttons: Record<'zoomIn' | 'zoomOut',
                { click: Subject<void> }>,
        }).buttons;
        buttons.zoomIn.click.next();
        expect(zoom()).toBeCloseTo(DEFAULT_ZOOM * ZOOM_STEP ** 2, 6);
        buttons.zoomOut.click.next();
        buttons.zoomOut.click.next();
        expect(zoom()).toBeCloseTo(DEFAULT_ZOOM / ZOOM_STEP ** 2, 6);
        starmap.dismiss();
        await shown;
    });

    it('opens Find on `f`; Find selects the named system', async () => {
        const { starmap, shown, internals, press, selected } = await openMap();
        const find = internals.findDialog;
        expect(find.shown).toBeFalse();
        press('attack');
        expect(find.shown).toBeTrue();
        find.type('Map Far');
        find.confirm();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(find.shown).toBeFalse();
        expect(selected).toContain(FAR);
        starmap.dismiss();
        await shown;
    });

    it('leaves the display scale keys alone while Find is up', async () => {
        const { starmap, shown, internals, press, zoom } = await openMap();
        press('attack');
        const before = zoom();
        // The field holds the keyboard (its own focused MenuControls).
        press('globalScaleUp');
        expect(zoom()).toBe(before);
        internals.findDialog.cancel();
        await new Promise(resolve => setTimeout(resolve, 0));
        starmap.dismiss();
        await shown;
    });

    /** The map content's screen offset (the pan). */
    function mapPosition(starmap: Starmap): { x: number, y: number } {
        const { x, y } = (starmap as unknown as {
            systemGraph: { viewport: { mapContainer: PIXI.Container } },
        }).systemGraph.viewport.mapContainer.position;
        return { x, y };
    }

    function zoomButtons(starmap: Starmap) {
        return (starmap as unknown as {
            buttons: Record<'zoomIn' | 'zoomOut',
                { click: Subject<void>, state: string }>,
        }).buttons;
    }

    /**
     * The "Smooth map zoom" NovaJS enhancement OFF: the original's controls
     * (reference "Star-map nebulae (nëbu), wave 53", items 1 and 4).
     */
    describe('with smooth map zoom off (the original)', () => {
        beforeEach(() => overrideEnhancements({ enhSmoothMapZoom: false }));
        afterEach(() => overrideEnhancements({}));

        const level = (scale: number) => scale / BASE_SCALE;

        it('opens at 177.7 % and steps through the seven levels', async () => {
            const { starmap, shown, press, zoom } = await openMap();
            expect(zoom() * BASE_SCALE).toBeCloseTo(DEFAULT_PX_PER_UNIT, 6);
            // One `=` reaches 237 %, where + greys out and a second does
            // nothing.
            press('globalScaleUp');
            expect(zoom()).toBeCloseTo(level(2.37), 6);
            expect(zoomButtons(starmap).zoomIn.state).toBe('grey');
            press('globalScaleUp');
            expect(zoom()).toBeCloseTo(level(2.37), 6);
            // Down through every level to 42.1 %, where - greys out.
            const seen: number[] = [];
            for (let i = 0; i < 7; i++) {
                press('globalScaleDown');
                seen.push(zoom() * BASE_SCALE);
            }
            expect(seen.map(s => Number(s.toFixed(3)))).toEqual(
                [1.77, 1.333, 1, 0.75, 0.562, 0.421, 0.421]);
            expect(zoomButtons(starmap).zoomOut.state).toBe('grey');
            expect(zoomButtons(starmap).zoomIn.state).toBe('normal');
            starmap.dismiss();
            await shown;
        });

        it('takes the same level step on the - / + buttons', async () => {
            const { starmap, shown, zoom } = await openMap();
            zoomButtons(starmap).zoomOut.click.next();
            expect(zoom()).toBeCloseTo(level(1.333), 6);
            zoomButtons(starmap).zoomIn.click.next();
            expect(zoom()).toBeCloseTo(DEFAULT_ZOOM, 6);
            starmap.dismiss();
            await shown;
        });

        it('pans 10 map units an arrow press at every zoom, unbounded',
            async () => {
                const { starmap, shown, press } = await openMap();
                for (const [presses, scale] of [[1, 2.37], [6, 0.421]]) {
                    for (let i = 0; i < presses!; i++) {
                        press(i === 0 && scale! > 2
                            ? 'globalScaleUp' : 'globalScaleDown');
                    }
                    const before = mapPosition(starmap);
                    press('right');
                    press('down');
                    const after = mapPosition(starmap);
                    // 23.7 px at 237 %, 4.21 at 42.1 %; content moves
                    // left / up as the view looks right / down.
                    expect(before.x - after.x).toBeCloseTo(10 * scale!, 6);
                    expect(before.y - after.y).toBeCloseTo(10 * scale!, 6);
                }
                // 400 presses, far past every system: never clamped.
                const start = mapPosition(starmap);
                for (let i = 0; i < 400; i++) {
                    press('left');
                }
                expect(mapPosition(starmap).x - start.x)
                    .toBeCloseTo(4000 * 0.421, 3);
                starmap.dismiss();
                await shown;
            });

        it('steps one level a wheel detent; a pinch a level per x 4/3',
            async () => {
                const { starmap, shown, zoom } = await openMap();
                const graph = (starmap as unknown as {
                    systemGraph: { wheelZoom(factor: number, x: number,
                        y: number, notched: boolean): void },
                }).systemGraph;
                graph.wheelZoom(1 / ZOOM_STEP, 10, 10, true);
                expect(zoom()).toBeCloseTo(level(1.333), 6);
                // Three x 1.1 (1.331) is short of a level; a fourth is one.
                for (let i = 0; i < 3; i++) {
                    graph.wheelZoom(1.1, 10, 10, false);
                }
                expect(zoom()).toBeCloseTo(level(1.333), 6);
                graph.wheelZoom(1.1, 10, 10, false);
                expect(zoom()).toBeCloseTo(DEFAULT_ZOOM, 6);
                starmap.dismiss();
                await shown;
            });
    });

    describe('with smooth map zoom on (NovaJS)', () => {
        afterEach(() => overrideEnhancements({}));

        it('keeps the pan near the galaxy and both buttons live', async () => {
            overrideEnhancements({ enhSmoothMapZoom: true });
            const { starmap, shown, press } = await openMap();
            const start = mapPosition(starmap);
            for (let i = 0; i < 400; i++) {
                press('left');
            }
            // Clamped long before 400 x 40 px.
            expect(mapPosition(starmap).x - start.x).toBeLessThan(1000);
            for (let i = 0; i < 30; i++) {
                press('globalScaleUp');
            }
            expect(zoomButtons(starmap).zoomIn.state).toBe('normal');
            starmap.dismiss();
            await shown;
        });
    });
});

describe('originalZoomStep and PinchLevelStepper', () => {
    it('steps to the neighbouring level, snapping from between two', () => {
        const at = (scale: number) => scale / BASE_SCALE;
        expect(originalZoomStep(DEFAULT_ZOOM, 1)).toBe(at(2.37));
        expect(originalZoomStep(DEFAULT_ZOOM, -1)).toBe(at(1.333));
        expect(originalZoomStep(at(2.37), 1)).toBeUndefined();
        expect(originalZoomStep(at(0.421), -1)).toBeUndefined();
        expect(originalZoomStep(at(1.1), 1)).toBe(at(1.333));
        expect(originalZoomStep(at(1.1), -1)).toBe(at(1));
        expect(ORIGINAL_ZOOM_LEVELS.length).toBe(7);
    });

    it('gathers a pinch into whole levels, dropping the remainder on a '
        + 'reversal', () => {
            const stepper = new PinchLevelStepper();
            expect(stepper.steps(1.2)).toBe(0);
            expect(stepper.steps(1.2)).toBe(1); // 1.44 > 4/3
            expect(stepper.steps(0.95)).toBe(0); // the 1.08 left is dropped
            expect(stepper.steps(0.8)).toBe(0); // 0.76 > 3/4
            expect(stepper.steps(0.9)).toBe(-1);
            expect(stepper.steps(16 / 9 * 1.01)).toBe(2);
        });
});
