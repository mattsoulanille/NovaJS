import 'jasmine';
import * as PIXI from 'pixi.js';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { SystemData } from 'novadatainterface/system_data';
import { getSyntheticGameData } from '../communication/simulation_test_fixture.js';
import { overrideEnhancements } from '../enhancements.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import {
    MINI_MAP_FADE_MS, MINI_MAP_FRAME, MINI_MAP_ORIGINAL_CLICK_WINDOW_MS,
    MINI_MAP_PANE, MINI_MAP_PEEK_MS,
    MiniMap, MiniMapPeek, miniMapAlpha, miniMapPosition,
} from './mini_map.js';
import { SystemGraph } from './system_graph.js';

const { thessaly, kestrel, ossory, vael } = SYNTHETIC.systems;

describe('the `h` hyperspace minimap', () => {
    it('sits where mini_map.png has it at 1920x1080', () => {
        // The civilian status bar is 194 px wide (x 1726..1919); the
        // minimap's outline spans x 1230..1709, y 150..629.
        const { x, y } = miniMapPosition({ x: 1920 }, 194);
        expect(x).toBe(1230);
        expect(y).toBe(150);
        expect(x + MINI_MAP_FRAME - 1).toBe(1709);
        expect(MINI_MAP_PANE.x + 2).toBe(MINI_MAP_FRAME);
    });

    describe('with a map in it', () => {
        let systems: SystemData[];

        beforeAll(async () => {
            installHeadlessPixi();
            const gameData = await getSyntheticGameData();
            systems = await Promise.all([thessaly, kestrel, ossory, vael]
                .map(id => gameData.data.System.get(id)));
        });

        const graph = () => new SystemGraph(systems, thessaly,
            { size: MINI_MAP_PANE, miniMap: true });

        it('reports each pick with the graph it was made on', () => {
            const miniMap = new MiniMap(() => 0);
            const shown = graph();
            miniMap.setGraph(shown);
            const picks: string[][] = [];
            miniMap.picked.subscribe(g => picks.push(g.getEffectiveRoute()));
            shown.clickSystem(kestrel);
            shown.clickSystem(ossory);
            expect(picks).toEqual([[kestrel], [ossory]]);
        });

        it('forgets a graph it no longer shows', () => {
            const miniMap = new MiniMap(() => 0);
            const old = graph();
            miniMap.setGraph(old);
            miniMap.setGraph(graph());
            let picks = 0;
            miniMap.picked.subscribe(() => picks++);
            // (A destroyed graph is off screen and cannot be clicked; its
            // stream is what must not leak picks through.)
            old.routeChanged.next();
            expect(picks).toBe(0);
            expect(old.container.destroyed).toBeTrue();
        });

        it('starts hidden and keeps the map inside its outline', () => {
            const miniMap = new MiniMap(() => 0);
            expect(miniMap.container.visible).toBeFalse();
            const shown = graph();
            miniMap.setGraph(shown);
            expect(shown.container.position.x).toBe(1);
            expect(shown.container.position.y).toBe(1);
        });
    });

    describe('as a peek', () => {
        let systems: SystemData[];
        let clock: number;
        const now = () => clock;

        beforeAll(async () => {
            installHeadlessPixi();
            const gameData = await getSyntheticGameData();
            systems = await Promise.all([thessaly, kestrel, ossory, vael]
                .map(id => gameData.data.System.get(id)));
        });
        beforeEach(() => {
            clock = 10_000;
        });

        function shown(): MiniMap {
            const miniMap = new MiniMap(now);
            const graph = new SystemGraph(systems, thessaly,
                { size: MINI_MAP_PANE, miniMap: true });
            graph.zoomBy(0.5);
            graph.center();
            miniMap.setGraph(graph);
            return miniMap;
        }

        /** Whether the map is on screen this frame. */
        function onScreen(miniMap: MiniMap): boolean {
            return miniMap.container.visible
                && miniMap.container.alpha > 0;
        }

        it('stays lit the original\'s 60 frames at 30 fps, then fades and hides', () => {
            expect(MINI_MAP_PEEK_MS).toBe(2000);
            const miniMap = shown();
            miniMap.update(true);
            expect(onScreen(miniMap)).toBeFalse();
            miniMap.peek();
            miniMap.update(true);
            expect(onScreen(miniMap)).toBeTrue();
            expect(miniMap.container.alpha).toBe(1);
            clock += 1999;
            miniMap.update(true);
            expect(miniMap.container.alpha).toBe(1);
            clock += 1 + MINI_MAP_FADE_MS - 1;
            miniMap.update(true);
            expect(onScreen(miniMap)).toBeTrue();
            clock += 1;
            miniMap.update(true);
            expect(onScreen(miniMap)).toBeFalse();
        });

        it('starts over on a second press instead of closing', () => {
            const miniMap = shown();
            miniMap.peek();
            clock += 1500;
            miniMap.peek();
            miniMap.update(true);
            expect(onScreen(miniMap)).toBeTrue();
            clock += 1999;
            miniMap.update(true);
            expect(miniMap.container.alpha).toBe(1);
            clock += 1 + MINI_MAP_FADE_MS;
            miniMap.update(true);
            expect(onScreen(miniMap)).toBeFalse();
        });

        it('keeps its deadline in the state it was handed', () => {
            // The plugin keeps one across display-world rebuilds.
            const peek: MiniMapPeek = { until: -Infinity };
            new MiniMap(now, peek).peek();
            expect(peek.until).toBe(clock + MINI_MAP_PEEK_MS);
            expect(new MiniMap(now, peek).showing).toBeTrue();
        });

        it('is neither drawn nor clickable while inactive', () => {
            const miniMap = shown();
            miniMap.peek();
            miniMap.update(false);
            expect(miniMap.container.visible).toBeFalse();
        });

        /** What PIXI's event system would hit at a pane-local point, on a
         * stage holding only the minimap at the origin. */
        function hitAt(miniMap: MiniMap, x: number, y: number) {
            const stage = new PIXI.Container();
            stage.addChild(miniMap.container);
            // +1: the pane sits inside the 1px outline.
            const hit = new PIXI.EventBoundary(stage).hitTest(x + 1, y + 1);
            stage.removeChild(miniMap.container);
            return hit;
        }
        const centre = MINI_MAP_PANE.x / 2;

        it('takes the whole pane\'s clicks while shown', () => {
            const miniMap = shown();
            miniMap.peek();
            miniMap.update(true);
            expect(miniMap.takesInput).toBeTrue();
            // The current system (in the middle of the pane) and empty
            // space in a corner: both are the map's, never what is
            // underneath.
            expect(hitAt(miniMap, centre, centre))
                .toBe(miniMap.current!.container);
            expect(hitAt(miniMap, 3, 3)).toBe(miniMap.current!.container);
            // Never outside the pane.
            const hit = miniMap.current!.container.hitArea!;
            expect(hit.contains(-1, centre)).toBeFalse();
            expect(hit.contains(MINI_MAP_PANE.x, centre)).toBeFalse();
        });

        it('takes no pointer input while hidden', () => {
            const miniMap = shown();
            miniMap.update(true);
            // Never shown yet: nothing of it is hit, not even a system.
            expect(miniMap.takesInput).toBeFalse();
            expect(miniMap.container.eventMode).toBe('none');
            expect(hitAt(miniMap, centre, centre)).toBeNull();
            expect(hitAt(miniMap, 3, 3)).toBeNull();
            // Shown, then hidden again.
            miniMap.peek();
            miniMap.update(true);
            expect(hitAt(miniMap, centre, centre)).not.toBeNull();
            clock += MINI_MAP_PEEK_MS + MINI_MAP_FADE_MS;
            miniMap.update(true);
            expect(miniMap.container.visible).toBeFalse();
            expect(miniMap.takesInput).toBeFalse();
            expect(hitAt(miniMap, centre, centre)).toBeNull();
            expect(miniMap.current!.container.hitArea!
                .contains(centre, centre)).toBeFalse();
        });

        it('takes no input once a peek runs out, even before the next '
            + 'frame', () => {
                const miniMap = shown();
                miniMap.peek();
                miniMap.update(true);
                clock += MINI_MAP_PEEK_MS;
                // No update() yet: the hit area itself refuses.
                expect(miniMap.current!.container.hitArea!
                    .contains(centre, centre)).toBeFalse();
            });

        describe('with "Hidden h-map ignores clicks" off (the original)',
            () => {
                beforeEach(() => overrideEnhancements(
                    { enhMiniMapHiddenNoClicks: false }));
                afterEach(() => overrideEnhancements({}));

                it('keeps taking clicks, hidden, until 8 s from the show',
                    () => {
                        const miniMap = shown();
                        miniMap.peek();
                        miniMap.update(true);
                        clock += MINI_MAP_PEEK_MS + MINI_MAP_FADE_MS + 2000;
                        miniMap.update(true);
                        // Faded out: nothing drawn...
                        expect(miniMap.container.alpha).toBe(0);
                        // ...but its area still picks.
                        expect(miniMap.takesInput).toBeTrue();
                        expect(hitAt(miniMap, centre, centre))
                            .not.toBeNull();
                        clock = 10_000 + MINI_MAP_ORIGINAL_CLICK_WINDOW_MS;
                        miniMap.update(true);
                        expect(miniMap.takesInput).toBeFalse();
                        expect(miniMap.container.visible).toBeFalse();
                        expect(hitAt(miniMap, centre, centre)).toBeNull();
                    });

                it('still takes nothing before the first show, or while '
                    + 'inactive', () => {
                        const miniMap = shown();
                        miniMap.update(true);
                        expect(miniMap.takesInput).toBeFalse();
                        miniMap.peek();
                        clock += MINI_MAP_PEEK_MS + 1000;
                        miniMap.update(false);
                        expect(miniMap.takesInput).toBeFalse();
                    });
            });

        it('takes no input while inactive, even during a peek', () => {
            const miniMap = shown();
            miniMap.peek();
            miniMap.update(false);
            expect(miniMap.takesInput).toBeFalse();
            expect(miniMap.container.eventMode).toBe('none');
            expect(hitAt(miniMap, centre, centre)).toBeNull();
        });

        it('fades out linearly over the original\'s 0.53 s once the peek ends', () => {
            expect(MINI_MAP_PEEK_MS).toBeCloseTo(2000);
            expect(MINI_MAP_FADE_MS).toBeCloseTo(533.3, 1);
            const miniMap = shown();
            const start = clock;
            miniMap.peek();
            clock += MINI_MAP_PEEK_MS - 1;
            miniMap.update(true);
            expect(miniMap.container.alpha).toBe(1);
            expect(miniMap.takesInput).toBeTrue();
            clock += 1 + MINI_MAP_FADE_MS / 2;
            miniMap.update(true);
            expect(miniMap.container.alpha).toBeCloseTo(0.5);
            expect(miniMap.container.visible).toBeTrue();
            expect(miniMap.takesInput).toBeFalse();
            clock = start + MINI_MAP_PEEK_MS + MINI_MAP_FADE_MS;
            miniMap.update(true);
            expect(miniMap.container.alpha).toBe(0);
            expect(miniMap.container.visible).toBeFalse();
        });

        it('can fade out over a set time, taking no input meanwhile', () => {
            // The curve a nonzero MINI_MAP_FADE_MS would use.
            expect(miniMapAlpha(999, 1000, 300)).toBe(1);
            expect(miniMapAlpha(1000, 1000, 300)).toBe(1);
            expect(miniMapAlpha(1150, 1000, 300)).toBeCloseTo(0.5);
            expect(miniMapAlpha(1300, 1000, 300)).toBe(0);
            expect(miniMapAlpha(1000, 1000, 0)).toBe(0);
            // Input stops where the fade starts, whatever its length.
            const miniMap = shown();
            miniMap.peek();
            miniMap.update(true);
            clock += MINI_MAP_PEEK_MS;
            expect(miniMap.takesInput).toBeFalse();
        });

        it('stays up for another peek on a press while shown', () => {
            const miniMap = shown();
            miniMap.peek();
            miniMap.update(true);
            clock += MINI_MAP_PEEK_MS - 100;
            const press = {
                pointerId: 1,
                global: new PIXI.Point(0, 0),
                getLocalPosition: () => new PIXI.Point(0, 0),
            } as unknown as PIXI.FederatedPointerEvent;
            miniMap.current!.container.emit('pointerdown', press);
            clock += MINI_MAP_PEEK_MS - 100;
            miniMap.update(true);
            expect(miniMap.showing).toBeTrue();
            expect(miniMap.takesInput).toBeTrue();
        });
    });
});
