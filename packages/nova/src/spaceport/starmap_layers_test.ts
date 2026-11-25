import 'jasmine';
import * as PIXI from 'pixi.js';
import { getDefaultSystemData, SystemData } from 'novadatainterface/system_data';
import {
    DISCOVERY_ENTERED, DISCOVERY_UNKNOWN, DiscoveryLevel,
} from '../nova_plugin/player/index.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import {
    CURRENT_SYSTEM_CENTER_COLOR, GATE_MAP_LANE_COLOR, LANE_COLOR,
    SYSTEM_INTERIOR_COLOR, SYSTEM_UNEXPLORED_COLOR,
} from './starmap_draw.js';
import { scalePos } from './starmap_viewport.js';
import { SystemGraph } from './system_graph.js';

/** A filled circle some layer of the map draws. */
interface Disc {
    layer: number;
    x: number;
    y: number;
    color: number;
}

/** Every filled circle in the map's layers, with the layer's draw index
 * (a higher index is drawn later, on top). */
function discs(graph: SystemGraph): Disc[] {
    const map = (graph as unknown as {
        viewport: { mapContainer: PIXI.Container },
    }).viewport.mapContainer;
    const out: Disc[] = [];
    map.children.forEach((child, layer) => {
        if (!(child instanceof PIXI.Graphics)) {
            return;
        }
        for (const data of child.geometry.graphicsData) {
            if (data.shape instanceof PIXI.Circle && data.fillStyle.visible) {
                out.push({
                    layer, x: data.shape.x, y: data.shape.y,
                    color: data.fillStyle.color,
                });
            }
        }
    });
    return out;
}

function system(id: string, position: [number, number],
    links: string[] = []): SystemData {
    return { ...getDefaultSystemData(), id, name: id, position, links };
}

const entered = (...ids: string[]) => (id: string): DiscoveryLevel =>
    ids.includes(id) ? DISCOVERY_ENTERED : DISCOVERY_UNKNOWN;

/**
 * The current system's #00adef centre sits in the dot's black interior on
 * every original map shot (map/borders_off.png, 896..899 x 500..503). It
 * used to be drawn on the route layer, UNDER the dots, where the interior
 * hid it on the regular star map (wave 25).
 */
describe('the star map\'s current-system centre', () => {
    beforeAll(() => installHeadlessPixi());

    const systems = [
        system('Here', [0, 0], ['There']),
        system('There', [40, 0], ['Here']),
    ];

    it('is drawn ABOVE the dots\' black interiors', () => {
        const graph = new SystemGraph(systems, 'Here',
            { discoveryOf: entered('Here', 'There') });
        const [x, y] = scalePos([0, 0]);
        const all = discs(graph).filter(d => d.x === x && d.y === y);
        const centre = all.filter(d => d.color === CURRENT_SYSTEM_CENTER_COLOR);
        const interior = all.filter(d => d.color === SYSTEM_INTERIOR_COLOR);
        expect(centre.length).toBe(1);
        expect(interior.length).toBe(1);
        expect(centre[0].layer).toBeGreaterThan(interior[0].layer);
    });

    it('moves with setCurrentSystem', () => {
        const graph = new SystemGraph(systems, 'Here',
            { discoveryOf: entered('Here', 'There') });
        graph.setCurrentSystem('There');
        const centres = discs(graph)
            .filter(d => d.color === CURRENT_SYSTEM_CENTER_COLOR);
        expect(centres.map(d => [d.x, d.y])).toEqual([scalePos([40, 0])]);
    });

    it('stays above the dots on the minimap too', () => {
        const graph = new SystemGraph(systems, 'Here',
            { discoveryOf: entered('Here', 'There'), miniMap: true });
        const [x, y] = scalePos([0, 0]);
        const all = discs(graph).filter(d => d.x === x && d.y === y);
        const centre = all.find(d => d.color === CURRENT_SYSTEM_CENTER_COLOR)!;
        const interior = all.find(d => d.color === SYSTEM_INTERIOR_COLOR)!;
        expect(centre.layer).toBeGreaterThan(interior.layer);
    });
});

/** The colour of every 1 px line the map's hyperspace-lane layer strokes. */
function laneColors(graph: SystemGraph): number[] {
    const g = (graph as unknown as { linkGraphics: PIXI.Graphics })
        .linkGraphics;
    // The last moveTo / lineTo path is still open until the next draw.
    (g as unknown as { finishPoly(): void }).finishPoly();
    return g.geometry.graphicsData
        .filter(d => d.lineStyle.visible && d.lineStyle.width === 1)
        .map(d => d.lineStyle.color);
}

/**
 * Measured: reference "Gate map, wave 27", Kit Gate N1 with N2 (a
 * hyperspace neighbour) and N3 (nobody's neighbour) unexplored. Each gets
 * a #424242 ring with no label under its arrowhead, and one click picks it
 * (wave 25's "no dot, not selectable" at A2 was a misread).
 */
describe('the gate map\'s unexplored destination', () => {
    beforeAll(() => installHeadlessPixi());

    // N1's gate links to N2 and N3; N1 - N2 is also a hyperspace lane.
    const systems = [
        system('N1', [0, 0], ['N2', 'Lane']),
        system('N2', [60, 0], ['N1']),
        system('N3', [0, -60]),
        system('Lane', [-60, 0], ['N1']),
    ];

    function gateMap() {
        return new SystemGraph(systems, 'N1', {
            gateLinks: [['N1', 'N2'], ['N1', 'N3']],
            selectable: new Set(['N2', 'N3']),
            discoveryOf: entered('N1', 'Lane'),
        });
    }

    for (const [id, position] of
        [['N2', [60, 0]], ['N3', [0, -60]]] as const) {
        it(`draws ${id} as the dark-grey ring and picks it in one click`,
            () => {
                const graph = gateMap();
                const [x, y] = scalePos(position);
                const rings = discs(graph)
                    .filter(d => d.x === x && d.y === y
                        && d.color !== SYSTEM_INTERIOR_COLOR);
                expect(rings.map(d => d.color))
                    .toEqual([SYSTEM_UNEXPLORED_COLOR]);
                const picked: string[] = [];
                graph.infoSelection.subscribe(s => picked.push(s));
                graph.clickSystem(id);
                expect(graph.selectedSystem).toBe(id);
                expect(picked).toEqual([id]);
            });
    }

    it('keeps the pick on further clicks (two more and a double-click '
        + 'left N2 picked)', () => {
            const graph = gateMap();
            for (let i = 0; i < 4; i++) {
                graph.clickSystem('N2');
            }
            expect(graph.selectedSystem).toBe('N2');
            // A plain system (Kit Gate Lane) does nothing; another offered
            // destination moves the pick.
            graph.clickSystem('Lane');
            expect(graph.selectedSystem).toBe('N2');
            graph.clickSystem('N3');
            expect(graph.selectedSystem).toBe('N3');
        });

    it('draws the ordinary hyperspace lanes nearly black, #080808', () => {
        const colors = laneColors(gateMap());
        expect(colors.length).toBe(2);
        expect(new Set(colors)).toEqual(new Set([GATE_MAP_LANE_COLOR]));
    });
});

/**
 * The regular star map's lanes are #4a4a4a (map/borders_off.png: 5,783 px
 * of it and none of the 0x666666 NovaJS drew; the `h` minimap's
 * mini_map.png too; reference "Gate map, wave 27").
 */
describe('the star map\'s hyperspace lanes', () => {
    beforeAll(() => installHeadlessPixi());

    const systems = [
        system('Here', [0, 0], ['There']),
        system('There', [40, 0], ['Here']),
    ];

    it('are #4a4a4a on the full map and the minimap', () => {
        for (const miniMap of [false, true]) {
            const graph = new SystemGraph(systems, 'Here',
                { discoveryOf: entered('Here', 'There'), miniMap });
            expect(laneColors(graph)).withContext(`${miniMap}`)
                .toEqual([LANE_COLOR]);
        }
        expect(LANE_COLOR).toBe(0x4a4a4a);
        expect(GATE_MAP_LANE_COLOR).toBe(0x080808);
    });
});
