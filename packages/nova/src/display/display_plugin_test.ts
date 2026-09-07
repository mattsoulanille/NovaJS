import "jasmine";
import * as PIXI from "pixi.js";
import { cameraCentre, Display } from "./display_plugin.js";
import { AnimationGraphicPlugin } from "./animation_graphic_plugin.js";
import { AnimationPlugin } from "../nova_plugin/core/index.js";
import { MovementExtrapolationPlugin } from "./movement_extrapolation_plugin.js";
import { ScreenSizePlugin } from "./screen_size_plugin.js";
import { DisplayRoot, Stage, WorldLayer } from "./stage_resource.js";
import { Space } from "./space_resource.js";

describe("Display plugin", () => {
    it("installs AnimationPlugin before AnimationGraphicPlugin", async () => {
        const plugins: unknown[] = [];
        const fakeWorld = {
            resources: {
                set: jasmine.createSpy("set"),
                get: jasmine.createSpy("get").and.returnValue(undefined),
                delete: jasmine.createSpy("delete"),
            },
            addPlugin: jasmine.createSpy("addPlugin").and.callFake(async (plugin: unknown) => {
                plugins.push(plugin);
            }),
            removePlugin: jasmine.createSpy("removePlugin").and.resolveTo(true),
            addSystem: jasmine.createSpy("addSystem"),
            removeSystem: jasmine.createSpy("removeSystem"),
        };

        await Display.build(fakeWorld as never);

        expect(fakeWorld.resources.set).toHaveBeenCalledWith(Stage, jasmine.anything());
        expect(fakeWorld.resources.set).toHaveBeenCalledWith(Space, jasmine.anything());

        const animationPluginIndex = plugins.indexOf(AnimationPlugin);
        const animationGraphicPluginIndex = plugins.indexOf(AnimationGraphicPlugin);
        expect(animationPluginIndex).toBeGreaterThanOrEqual(0);
        expect(animationGraphicPluginIndex).toBeGreaterThan(animationPluginIndex);
        expect(plugins[0]).toBe(ScreenSizePlugin);
    });

    it("installs MovementExtrapolationPlugin so the display world keeps "
        + "moving between simulation snapshots", async () => {
        // Without it, a rAF that gets no fresh simulation snapshot (a
        // steps=0 pump or a late worker round trip) renders a
        // pixel-identical duplicate frame and the next double-steps —
        // the 60<->30 fps judder of the 2026-08-31 Linux trace.
        const plugins: unknown[] = [];
        const fakeWorld = {
            resources: {
                set: jasmine.createSpy("set"),
                get: jasmine.createSpy("get").and.returnValue(undefined),
                delete: jasmine.createSpy("delete"),
            },
            addPlugin: jasmine.createSpy("addPlugin").and.callFake(async (plugin: unknown) => {
                plugins.push(plugin);
            }),
            removePlugin: jasmine.createSpy("removePlugin").and.resolveTo(true),
            addSystem: jasmine.createSpy("addSystem"),
            removeSystem: jasmine.createSpy("removeSystem"),
        };

        await Display.build(fakeWorld as never);

        expect(plugins).toContain(MovementExtrapolationPlugin);
    });

    /**
     * The UI scale needs a container it can scale that holds the UI and
     * nothing else, so the display world's containers are three deep:
     * `DisplayRoot` -> [`WorldLayer`, `Stage`]. `Stage` stays the name
     * every UI plugin adds itself to (a dozen call sites unchanged); the
     * world view moved down into `WorldLayer`, which the UI scale never
     * touches.
     */
    describe('layer structure', () => {
        async function buildLayers() {
            const set = new Map<unknown, unknown>();
            const fakeWorld = {
                resources: {
                    set: (key: unknown, value: unknown) => set.set(key, value),
                    get: (key: unknown) => set.get(key),
                    has: (key: unknown) => set.has(key),
                    delete: (key: unknown) => set.delete(key),
                },
                addPlugin: async () => undefined,
                removePlugin: async () => true,
                addSystem: () => undefined,
                removeSystem: () => undefined,
            };
            await Display.build(fakeWorld as never);
            return {
                root: set.get(DisplayRoot) as PIXI.Container,
                worldLayer: set.get(WorldLayer) as PIXI.Container,
                stage: set.get(Stage) as PIXI.Container,
                space: set.get(Space) as PIXI.Container,
            };
        }

        it('puts the world layer under the UI layer, both under the root',
            async () => {
                const { root, worldLayer, stage } = await buildLayers();
                // Draw order: the world first, the UI over it. A UI layer
                // drawn first would put the status bar under the ships.
                expect(root.children).toEqual([worldLayer, stage]);
            });

        it('keeps Space in the world layer, not the UI layer', async () => {
            const { worldLayer, stage, space } = await buildLayers();
            expect(space.parent).toBe(worldLayer);
            expect(stage.children).toEqual([]);
        });

        it('leaves both layers unscaled until the client applies a scale',
            async () => {
                const { worldLayer, stage } = await buildLayers();
                expect(worldLayer.scale.x).toBe(1);
                expect(stage.scale.x).toBe(1);
            });
    });

    /**
     * The camera centres the world view in the part of the window the
     * status bar does not cover. The status bar's width is measured in
     * UI-layer units, so at a UI scale other than 1 it has to be
     * converted before it can be subtracted from a world-layer width.
     */
    describe('cameraCentre', () => {
        it('centres in the space left of the status bar', () => {
            expect(cameraCentre({ x: 1920, y: 1080 }, 194, 1))
                .toEqual({ x: (1920 - 194) / 2, y: 540 });
        });

        it('scales the status bar width into world units', () => {
            // A 2x status bar covers 388 world pixels, not 194.
            expect(cameraCentre({ x: 1920, y: 1080 }, 194, 2))
                .toEqual({ x: (1920 - 388) / 2, y: 540 });
        });

        it('uses the world viewport, which the global scale shrinks', () => {
            // 3440 CSS pixels at 2x global scale is 1720 world units.
            expect(cameraCentre({ x: 1720, y: 720 }, 194, 1))
                .toEqual({ x: (1720 - 194) / 2, y: 360 });
        });
    });
});
