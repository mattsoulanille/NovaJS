import 'jasmine';
import { getDefaultSystemData, SystemData } from 'novadatainterface/system_data';
import {
    DISCOVERY_ENTERED, DISCOVERY_UNKNOWN, DiscoveryLevel,
} from '../nova_plugin/player/index.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { SystemGraph } from './system_graph.js';

/**
 * Tab on the full map (reference_experiments M7), on the test kit's map
 * region: the hub's links are deliberately not in id order, and the
 * original cycled SW, NE, WSW, South, East — link-slot order, the
 * unexplored East included — then straight back to SW.
 */
describe('Tab on the full star map', () => {
    beforeAll(() => installHeadlessPixi());

    const HUB = 'nova:2140', SOUTH = 'nova:2141', NE = 'nova:2142',
        EAST = 'nova:2143', SW = 'nova:2144', WSW = 'nova:2145';

    function system(id: string, name: string, position: [number, number],
        links: string[]): SystemData {
        return { ...getDefaultSystemData(), id, name, position, links };
    }

    const systems = [
        system(HUB, 'Map Hub', [-700, 400], [SW, NE, WSW, SOUTH, EAST]),
        system(SOUTH, 'Map South', [-700, 460], [HUB]),
        system(NE, 'Map NE', [-675, 357], [HUB]),
        system(EAST, 'Map East', [-660, 400], [HUB]),
        system(SW, 'Map SW', [-750, 450], [HUB]),
        system(WSW, 'Map WSW', [-728, 390], [HUB]),
    ];

    it('cycles the neighbours in link-slot order and wraps', () => {
        const map = new SystemGraph(systems, HUB, {
            discoveryOf: (id): DiscoveryLevel =>
                id === EAST ? DISCOVERY_UNKNOWN : DISCOVERY_ENTERED,
        });
        const picks: (string | undefined)[] = [];
        for (let i = 0; i < 6; i++) {
            map.cycleSingleRoute(1);
            picks.push(map.getRouteState().single);
        }
        expect(picks).toEqual([SW, NE, WSW, SOUTH, EAST, SW]);
        // Each pick is a single-jump route.
        expect(map.getEffectiveRoute()).toEqual([SW]);
    });

    /**
     * Reference "Tab on the hypergate map, wave 56", at stock Alphara
     * (links Vega, Vemap, Spica, Sol, Sol's hidden NCB copy) with the route
     * Alphara > Vemap > Heraan Cov plotted: Tab went on from its last pick
     * through Sol, Vega, Vemap, skipping only the copy the map hides; the
     * route's own first hop is no exception, and the route stays plotted.
     */
    it('cycles every visible neighbour with a route plotted, keeping it',
        () => {
            const sys = (id: string, links: string[], x: number,
                visibility = ''): SystemData => ({
                ...getDefaultSystemData(), id, name: id,
                position: [x, 0], links, visibility,
            });
            const map = new SystemGraph([
                sys('alphara', ['vega', 'vemap', 'spica', 'sol', 'solB'], 0),
                sys('vega', ['alphara'], 10),
                sys('vemap', ['alphara', 'heraan'], 20),
                sys('heraan', ['vemap'], 30),
                sys('spica', ['alphara'], 40),
                sys('sol', ['alphara'], 50, '!b147'),
                sys('solB', ['alphara'], 50, 'b147'),
            ], 'alphara', { discoveryOf: () => DISCOVERY_ENTERED });
            map.clickSystem('vemap', true);
            map.clickSystem('heraan', true);
            expect(map.getRouteState().pinned).toEqual(['vemap', 'heraan']);
            const picks: (string | undefined)[] = [];
            for (let i = 0; i < 5; i++) {
                map.cycleSingleRoute(1);
                picks.push(map.getRouteState().single);
            }
            expect(picks).toEqual(['vega', 'vemap', 'spica', 'sol', 'vega']);
            expect(map.getRouteState().pinned).toEqual(['vemap', 'heraan']);
        });
});
