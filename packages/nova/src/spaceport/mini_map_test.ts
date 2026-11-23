import 'jasmine';
import * as PIXI from 'pixi.js';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { SystemData } from 'novadatainterface/system_data';
import { getSyntheticGameData } from '../communication/simulation_test_fixture.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import {
    MINI_MAP_FRAME, MINI_MAP_PANE, MINI_MAP_PEEK_MS, MiniMap, MiniMapPeek,
    miniMapPosition,
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

        it('lasts the original\'s 66 frames at 30 fps, then hides', () => {
            expect(MINI_MAP_PEEK_MS).toBe(2200);
            const miniMap = shown();
            miniMap.update(true);
            expect(onScreen(miniMap)).toBeFalse();
            miniMap.peek();
            miniMap.update(true);
            expect(onScreen(miniMap)).toBeTrue();
            clock += 2199;
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
            clock += 2000;
            miniMap.update(true);
            expect(onScreen(miniMap)).toBeTrue();
            clock += 200;
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

        it('takes clicks only on systems while hidden', () => {
            const miniMap = shown();
            miniMap.update(true);
            const hit = miniMap.current!.container.hitArea!;
            const centre = MINI_MAP_PANE.x / 2;
            // The current system sits in the middle of the pane.
            expect(hit.contains(centre, centre)).toBeTrue();
            // Empty space in a corner passes through to space.
            expect(hit.contains(3, 3)).toBeFalse();
            miniMap.peek();
            expect(hit.contains(3, 3)).toBeTrue();
            // Never outside the pane.
            expect(hit.contains(-1, centre)).toBeFalse();
            expect(hit.contains(MINI_MAP_PANE.x, centre)).toBeFalse();
        });

        it('shows itself on a press where it sits', () => {
            const miniMap = shown();
            miniMap.update(true);
            expect(miniMap.showing).toBeFalse();
            const press = {
                pointerId: 1,
                global: new PIXI.Point(0, 0),
                getLocalPosition: () => new PIXI.Point(0, 0),
            } as unknown as PIXI.FederatedPointerEvent;
            miniMap.current!.container.emit('pointerdown', press);
            expect(miniMap.showing).toBeTrue();
        });
    });
});
