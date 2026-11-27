import 'jasmine';
import { getDefaultSystemData, SystemData } from 'novadatainterface/system_data';
import * as PIXI from 'pixi.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import {
    buildAdjacency, effectiveRoute, pickOnMiniMap, reconcileRouteState,
    RouteState, settleMiniMapPick,
} from './route.js';
import { drawRouteOverlay } from './starmap_draw.js';
import { SystemGraph } from './system_graph.js';

/**
 * A pick on the `h` minimap over a multi-jump route (reference "Map keys,
 * minimap routes and ctrl-clicks (K4, M2, M3), wave 41", the kit's map
 * region): with Hub -> East -> Void -> Far plotted, a minimap pick of SW
 * made the nav read "Map SW" while the route stayed drawn, its first hop
 * pale on the minimap; after the full map's Done the nav read East (the
 * route's first hop) again and the minimap drew no SW line.
 */
describe('a minimap pick over a multi-jump route (M2, wave 41)', () => {
    const HUB = 'nova:2140', EAST = 'nova:2143', VOID = 'nova:2147',
        FAR = 'nova:2146', SW = 'nova:2144';

    function system(id: string, name: string, position: [number, number],
        links: string[]): SystemData {
        return { ...getDefaultSystemData(), id, name, position, links };
    }

    const systems = [
        system(HUB, 'Map Hub', [-700, 400], [SW, EAST]),
        system(EAST, 'Map East', [-660, 400], [HUB, VOID]),
        system(VOID, 'Map Void', [-620, 400], [EAST, FAR]),
        system(FAR, 'Map Far', [-580, 400], [VOID]),
        system(SW, 'Map SW', [-750, 450], [HUB]),
    ];
    const adj = buildAdjacency(systems);
    const plotted: RouteState = { pinned: [EAST, VOID, FAR] };

    describe('the route state', () => {
        it('makes the pick the next jump and keeps the route', () => {
            const picked = pickOnMiniMap(adj, HUB, plotted, SW);
            expect(picked).toEqual(
                { pinned: [EAST, VOID, FAR], single: SW, singleFirst: true });
            expect(effectiveRoute(adj, HUB, picked)).toEqual([SW]);
        });

        it('changes nothing about the jump when the pick is the route\'s '
            + 'own first hop', () => {
            const picked = pickOnMiniMap(adj, HUB, plotted, EAST);
            expect(picked.singleFirst).toBeUndefined();
            expect(effectiveRoute(adj, HUB, picked)).toEqual([EAST, VOID, FAR]);
        });

        it('is a plain single jump with no route to override', () => {
            const picked = pickOnMiniMap(adj, HUB, { pinned: [] }, SW);
            expect(picked).toEqual({ pinned: [], single: SW });
            expect(effectiveRoute(adj, HUB, picked)).toEqual([SW]);
        });

        it('keeps the multi-jump route first for a full-map single', () => {
            expect(effectiveRoute(adj, HUB, { ...plotted, single: SW }))
                .toEqual([EAST, VOID, FAR]);
        });

        it('lasts until the full map\'s Done, which drops the pick', () => {
            const picked = pickOnMiniMap(adj, HUB, plotted, SW);
            // Reopening the map (or the minimap) keeps it.
            const reopened = reconcileRouteState(picked, HUB, adj, [SW]);
            expect(reopened).toEqual(picked);
            const settled = settleMiniMapPick(adj, HUB, reopened);
            expect(settled).toEqual({ pinned: [EAST, VOID, FAR], single: undefined });
            expect(effectiveRoute(adj, HUB, settled)).toEqual([EAST, VOID, FAR]);
        });

        it('keeps a pick at Done when no route is left to override', () => {
            const settled = settleMiniMapPick(adj, HUB,
                { pinned: [], single: SW, singleFirst: true });
            expect(settled).toEqual({ pinned: [], single: SW });
        });

        it('forgets the precedence once the pick is no longer a neighbour',
            () => {
                const picked = pickOnMiniMap(adj, HUB, plotted, SW);
                const arrived = reconcileRouteState(picked, SW, adj, []);
                expect(arrived.single).toBeUndefined();
                expect(arrived.singleFirst).toBeUndefined();
            });
    });

    describe('after a multi-jump (wave 52\'s MJ, dropPassedPins)', () => {
        // Hub -> East -> Void -> Far flown by one ModVal-2 `j` from Hub to
        // Void via East: the sim route is left [Far], and the `h`
        // minimap's build reconciles the passed pins away BEFORE any pick
        // (Starmap.miniMapGraph consumes RouteStateStore.arrival).
        const arrived = reconcileRouteState(plotted, VOID, adj, [FAR],
            undefined, { from: HUB, hops: [EAST, VOID] });

        it('reconciles to the rest of the route', () => {
            expect(arrived).toEqual({ pinned: [FAR], single: undefined });
            expect(effectiveRoute(adj, VOID, arrived)).toEqual([FAR]);
        });

        it('makes a pick of the passed system the next jump, until Done',
            () => {
                // East is a neighbour of Void but no longer on the route:
                // without the drop it would still be the route's first hop
                // (Void -> East -> Void -> Far) and the pick a no-op.
                const picked = pickOnMiniMap(adj, VOID, arrived, EAST);
                expect(picked).toEqual(
                    { pinned: [FAR], single: EAST, singleFirst: true });
                expect(effectiveRoute(adj, VOID, picked)).toEqual([EAST]);
                const settled = settleMiniMapPick(adj, VOID,
                    reconcileRouteState(picked, VOID, adj, [EAST]));
                expect(effectiveRoute(adj, VOID, settled)).toEqual([FAR]);
            });

        it('takes a pick of the remaining route\'s first hop as the route',
            () => {
                const picked = pickOnMiniMap(adj, VOID, arrived, FAR);
                expect(picked.singleFirst).toBeUndefined();
                expect(effectiveRoute(adj, VOID, picked)).toEqual([FAR]);
            });
    });

    describe('the minimap graph', () => {
        beforeAll(() => installHeadlessPixi());

        function miniGraph(state: RouteState): SystemGraph {
            const graph = new SystemGraph(systems, HUB,
                { size: { x: 478, y: 478 }, miniMap: true });
            graph.setRouteState(state);
            return graph;
        }

        it('takes the pick as the next jump', () => {
            const graph = miniGraph(plotted);
            expect(graph.getEffectiveRoute()).toEqual([EAST, VOID, FAR]);
            graph.clickSystem(SW);
            expect(graph.getEffectiveRoute()).toEqual([SW]);
            expect(graph.getRouteState().pinned).toEqual([EAST, VOID, FAR]);
        });

        it('drops the pick on the full map\'s Done (settleMiniMapPick)', () => {
            const graph = miniGraph(plotted);
            graph.clickSystem(SW);
            graph.settleMiniMapPick();
            expect(graph.getEffectiveRoute()).toEqual([EAST, VOID, FAR]);
            expect(graph.getRouteState().single).toBeUndefined();
        });

        it('lets a full-map click or Tab take the precedence back', () => {
            const full = new SystemGraph(systems, HUB, {});
            full.setRouteState(pickOnMiniMap(adj, HUB, plotted, SW));
            expect(full.getEffectiveRoute()).toEqual([SW]);
            full.cycleSingleRoute(1);
            expect(full.getRouteState().singleFirst).toBeUndefined();
            expect(full.getEffectiveRoute()).toEqual([EAST, VOID, FAR]);
        });
    });

    describe('the drawing', () => {
        beforeAll(() => installHeadlessPixi());

        const byId = new Map(systems.map(s => [s.id, s]));
        const GREEN = 0x00ff00, PALE = 0xb6b6b6, SINGLE = 0x00b400;

        /** [colour, from-x, to-x] of every route stroke, in draw order. */
        function strokes(miniMap: boolean, paleFirstHop: boolean,
            single?: string): [number, number, number][] {
            const g = new PIXI.Graphics();
            drawRouteOverlay(g, {
                miniMap, paleFirstHop,
                current: byId.get(HUB),
                single: single === undefined ? undefined : byId.get(single),
                multi: [EAST, VOID, FAR].map(id => byId.get(id)!),
                pinned: [],
            });
            (g as unknown as { finishPoly(): void }).finishPoly();
            return g.geometry.graphicsData
                .filter(d => d.lineStyle.visible
                    && d.shape instanceof PIXI.Polygon
                    && d.shape.points.length === 4)
                .map(d => {
                    const points = (d.shape as PIXI.Polygon).points;
                    return [d.lineStyle.color, points[0], points[2]];
                });
        }

        it('draws the route strong green on the minimap', () => {
            expect(strokes(true, false).map(([c]) => c))
                .toEqual([GREEN, GREEN, GREEN]);
        });

        it('pales only the first hop beside a minimap pick', () => {
            const drawn = strokes(true, true, SW);
            expect(drawn.map(([c]) => c)).toEqual([SINGLE, PALE, GREEN, GREEN]);
            // The pale hop is Hub -> East.
            expect(drawn[1]![1]).toBe(-1400);
            expect(drawn[1]![2]).toBe(-1320);
        });

        it('never pales the full map\'s route', () => {
            expect(strokes(false, true, SW).map(([c]) => c))
                .toEqual([SINGLE, GREEN, GREEN, GREEN]);
        });
    });
});
