import 'jasmine';
import * as PIXI from 'pixi.js';
import { getDefaultSystemData, SystemData } from 'novadatainterface/system_data';
import {
    DISCOVERY_ENTERED, DISCOVERY_UNKNOWN, DiscoveryLevel,
} from '../nova_plugin/player/index.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import {
    CURRENT_SYSTEM_CENTER_COLOR, SYSTEM_INTERIOR_COLOR,
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

/**
 * Measured: reference "Wave-24 leftovers, wave 25", Kit Gate A1 with ONLY
 * its own system explored. The gate map draws the arrow A1 -> A2 at full
 * length but no dot (and no name) at A2.
 */
describe('the gate map\'s unexplored destination', () => {
    beforeAll(() => installHeadlessPixi());

    // Two gate systems with no hyperspace link: A2 is nobody's neighbour.
    const systems = [system('A1', [0, 0]), system('A2', [120, 0])];

    function gateMap(discoveryOf: (id: string) => DiscoveryLevel,
        selectable: string[]) {
        return new SystemGraph(systems, 'A1', {
            gateLinks: [['A1', 'A2']], selectable: new Set(selectable),
            discoveryOf,
        });
    }

    it('gets no dot while unexplored', () => {
        const graph = gateMap(entered('A1'), []);
        const [x, y] = scalePos([120, 0]);
        expect(discs(graph).filter(d => d.x === x && d.y === y)).toEqual([]);
        // ... and a click there picks nothing.
        graph.clickSystem('A2');
        expect(graph.selectedSystem).toBeUndefined();
    });

    it('gets its dot once explored', () => {
        const graph = gateMap(entered('A1', 'A2'), ['A2']);
        const [x, y] = scalePos([120, 0]);
        expect(discs(graph).filter(d => d.x === x && d.y === y).length)
            .toBeGreaterThan(0);
    });
});
