import 'jasmine';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { SystemData } from 'novadatainterface/system_data';
import { getSyntheticGameData } from '../communication/simulation_test_fixture.js';
import {
    DISCOVERY_ENTERED, DISCOVERY_UNKNOWN, DiscoveryLevel,
} from '../nova_plugin/player/index.js';
import { MissionMapMark } from '../nova_plugin/missions/index.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { SystemGraph } from './system_graph.js';

/**
 * ============================================================================
 * Plotting routes on the map: known systems only, and the `h` minimap
 * ============================================================================
 *
 * The synthetic galaxy is a chain:
 *
 *     Ossory Shoal - Thessaly Reach - Kestrel Drift - Vael Hollow
 *
 * The pilot stands in Ossory and has explored Ossory and Thessaly. Kestrel
 * is a dim unexplored neighbour; Vael is two jumps into the unknown, drawn
 * only because an active mission marks it — exactly the far-away mission
 * dot of map_zoomed_out_showing_far_away_mission.png.
 *
 * Matthew (2026-11-23): "Systems that are forced to be visible by missions
 * marking them as destinations can be shift-clicked to create a route to
 * them, even through undiscovered systems. We should restrict the route
 * finder to known systems." The original's own D-U-U-D quirk (pinning
 * through two unexplored systems hop by hop) is deliberately NOT kept.
 */
const { thessaly, kestrel, ossory, vael } = SYNTHETIC.systems;

describe('the star map plots routes through explored systems only', () => {
    let systems: SystemData[];
    const marks: MissionMapMark[] = [
        { systemId: vael, kind: 'destination', missionId: 'nova:128' },
    ];

    beforeAll(async () => {
        installHeadlessPixi();
        const gameData = await getSyntheticGameData();
        systems = await Promise.all([thessaly, kestrel, ossory, vael]
            .map(id => gameData.data.System.get(id)));
    });

    function graph(explored: readonly string[], miniMap = false) {
        const known = new Set(explored);
        return new SystemGraph(systems, ossory, {
            missionMarks: marks,
            discoveryOf: (id): DiscoveryLevel =>
                known.has(id) ? DISCOVERY_ENTERED : DISCOVERY_UNKNOWN,
            miniMap,
        });
    }

    it('has the chain this spec assumes', () => {
        const map = graph([ossory, thessaly]);
        expect(map.adjacency.get(ossory)).toEqual([thessaly]);
        expect(map.adjacency.get(thessaly)).toContain(kestrel);
        expect(map.adjacency.get(kestrel)).toContain(vael);
        // The mission puts Vael on the map, explored or not.
        expect(map.hasSystem(vael)).toBeTrue();
    });

    it('refuses a shift-click on a mission system beyond the unknown', () => {
        const map = graph([ossory, thessaly]);
        let changes = 0;
        map.routeChanged.subscribe(() => changes++);
        map.clickSystem(vael, true);
        // No pin, no route, no partial route into Kestrel.
        expect(map.getRouteState()).toEqual({ pinned: [], single: undefined });
        expect(map.getEffectiveRoute()).toEqual([]);
        expect(changes).toBe(0);
        // It is still inspected, like any click on a system.
        expect(map.infoSystem).toBe(vael);
    });

    it('routes into an unexplored system next to explored space', () => {
        const map = graph([ossory, thessaly]);
        map.clickSystem(kestrel, true);
        expect(map.getRouteState().pinned).toEqual([kestrel]);
        expect(map.getEffectiveRoute()).toEqual([thessaly, kestrel]);
        // ...but not on past it (the original's D-U-U-D quirk).
        map.clickSystem(vael, true);
        expect(map.getRouteState().pinned).toEqual([kestrel]);
        expect(map.getEffectiveRoute()).toEqual([thessaly, kestrel]);
    });

    it('routes to the mission system once the way there is explored', () => {
        const map = graph([ossory, thessaly, kestrel]);
        map.clickSystem(vael, true);
        expect(map.getEffectiveRoute()).toEqual([thessaly, kestrel, vael]);
    });

    it('always lets a pin be removed', () => {
        const map = graph([ossory, thessaly]);
        map.clickSystem(kestrel, true);
        map.clickSystem(kestrel, true);
        expect(map.hasRoute).toBeFalse();
    });

    describe('the `h` minimap', () => {
        it('picks the single next jump with a plain click', () => {
            const map = graph([ossory, thessaly], true);
            let changes = 0;
            map.routeChanged.subscribe(() => changes++);
            map.clickSystem(thessaly);
            expect(map.getRouteState().single).toBe(thessaly);
            expect(map.getEffectiveRoute()).toEqual([thessaly]);
            expect(changes).toBe(1);
            // Clicking it again un-picks it, as on the full map.
            map.clickSystem(thessaly);
            expect(map.hasRoute).toBeFalse();
        });

        it('does nothing on shift-click', () => {
            const map = graph([ossory, thessaly, kestrel], true);
            let changes = 0;
            map.routeChanged.subscribe(() => changes++);
            for (const id of [thessaly, kestrel, vael]) {
                map.clickSystem(id, true);
            }
            expect(map.hasRoute).toBeFalse();
            expect(changes).toBe(0);
        });

        it('ignores a click on anything but a neighbour', () => {
            const map = graph([ossory, thessaly, kestrel], true);
            map.clickSystem(kestrel);
            map.clickSystem(vael);
            expect(map.hasRoute).toBeFalse();
            // No properties column, so nothing is inspected either.
            expect(map.infoSystem).toBeUndefined();
        });
    });
});
