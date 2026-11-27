import 'jasmine';
import { Position } from 'nova_ecs/datatypes/position';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { SystemData } from 'novadatainterface/system_data';
import { getSyntheticGameData } from '../communication/simulation_test_fixture.js';
import { makeSystem } from '../nova_plugin/make_system.js';
import {
    applyControlEvents, DISCOVERY_ENTERED, DISCOVERY_UNKNOWN, DiscoveryLevel,
    PlayerShipSelector,
} from '../nova_plugin/player/index.js';
import { MissionMapMark } from '../nova_plugin/missions/index.js';
import {
    FUEL_PER_JUMP, FuelComponent, makeShip, ShipPhysicsComponent,
} from '../nova_plugin/ship/index.js';
import { completeEntity } from '../nova_plugin/spawn/index.js';
import {
    FinishJump, FinishJumpEvent, JUMP_DISTANCE, JumpComponent,
    JumpRouteComponent,
} from '../nova_plugin/travel/index.js';
import { overrideEnhancements } from '../enhancements.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { SystemGraph } from './system_graph.js';

/**
 * ============================================================================
 * Plotting routes on the map: through every drawn system, and the `h` minimap
 * ============================================================================
 *
 * The synthetic galaxy is a chain:
 *
 *     Ossory Shoal - Thessaly Reach - Kestrel Drift - Vael Hollow
 *
 * The pilot stands in Ossory. What else they have explored varies per
 * spec; the map draws every explored system, its neighbours (the dim
 * unexplored ring) and Vael besides, because an active mission marks it —
 * the far-away mission dot of map_zoomed_out_showing_far_away_mission.png.
 *
 * Matthew (2026-11-23): "I should be allowed to plan a route through the
 * undiscovered system. D-U-D is allowed. Surprisingly, also D-U-U-D is
 * allowed." — the original's behaviour (reference_experiments M4). The
 * router flies through every system the map draws, and through nothing
 * else (route.ts, DRAWN SYSTEMS ONLY).
 */
const { thessaly, kestrel, ossory, vael } = SYNTHETIC.systems;

function discoveryOf(explored: readonly string[]) {
    const known = new Set(explored);
    return (id: string): DiscoveryLevel =>
        known.has(id) ? DISCOVERY_ENTERED : DISCOVERY_UNKNOWN;
}

describe('the star map plots routes through every drawn system', () => {
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
        return new SystemGraph(systems, ossory, {
            missionMarks: marks,
            discoveryOf: discoveryOf(explored),
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

    it('routes D-U-D with a single shift-click', () => {
        // Ossory (explored) - Thessaly (unexplored) - Kestrel (explored).
        const map = graph([ossory, kestrel]);
        map.clickSystem(kestrel, true);
        expect(map.getRouteState().pinned).toEqual([kestrel]);
        expect(map.getEffectiveRoute()).toEqual([thessaly, kestrel]);
    });

    it('routes D-U-D pin by pin', () => {
        const map = graph([ossory, kestrel]);
        map.clickSystem(thessaly, true);
        map.clickSystem(kestrel, true);
        expect(map.getRouteState().pinned).toEqual([thessaly, kestrel]);
        expect(map.getEffectiveRoute()).toEqual([thessaly, kestrel]);
    });

    it('routes D-U-U-D with a single shift-click', () => {
        // Ossory (explored) - Thessaly, Kestrel (both unexplored, each
        // drawn as a neighbour of explored space) - Vael (explored).
        const map = graph([ossory, vael]);
        let changes = 0;
        map.routeChanged.subscribe(() => changes++);
        map.clickSystem(vael, true);
        expect(map.getRouteState().pinned).toEqual([vael]);
        expect(map.getEffectiveRoute()).toEqual([thessaly, kestrel, vael]);
        expect(changes).toBe(1);
    });

    it('routes D-U-U-D pin by pin, as the original did', () => {
        // The original's Hub -> East -> Void -> Far (reference_experiments
        // M4): every pin extends the route, unexplored or not.
        const map = graph([ossory, vael]);
        map.clickSystem(thessaly, true);
        expect(map.getEffectiveRoute()).toEqual([thessaly]);
        map.clickSystem(kestrel, true);
        expect(map.getEffectiveRoute()).toEqual([thessaly, kestrel]);
        map.clickSystem(vael, true);
        expect(map.getRouteState().pinned).toEqual([thessaly, kestrel, vael]);
        expect(map.getEffectiveRoute()).toEqual([thessaly, kestrel, vael]);
    });

    it('routes to a mission system through the dim ring', () => {
        // Kestrel is unexplored but drawn (Thessaly's neighbour), so the
        // mission's Vael is in reach: D-D-U-U.
        const map = graph([ossory, thessaly]);
        map.clickSystem(vael, true);
        expect(map.getEffectiveRoute()).toEqual([thessaly, kestrel, vael]);
    });

    it('never routes through a system the map does not draw', () => {
        // Only Ossory is explored: Thessaly is the dim ring, Kestrel is two
        // jumps out and not drawn at all, and Vael is drawn only for the
        // mission — a bare dot with nothing drawn leading to it.
        const map = graph([ossory]);
        expect(map.passable(thessaly)).toBeTrue();
        expect(map.passable(kestrel)).toBeFalse();
        expect(map.passable(vael)).toBeTrue();
        let changes = 0;
        map.routeChanged.subscribe(() => changes++);
        map.clickSystem(vael, true);
        // No pin, no route, no partial route into Thessaly.
        expect(map.getRouteState()).toEqual({ pinned: [], single: undefined });
        expect(map.getEffectiveRoute()).toEqual([]);
        expect(changes).toBe(0);
        // It is still inspected, like any click on a system.
        expect(map.infoSystem).toBe(vael);
        // Pinning the dim neighbour first is no way round it.
        map.clickSystem(thessaly, true);
        map.clickSystem(vael, true);
        expect(map.getRouteState().pinned).toEqual([thessaly]);
        expect(map.getEffectiveRoute()).toEqual([thessaly]);
    });

    describe('with "Map auto-routing" off (the original)', () => {
        beforeEach(() => overrideEnhancements({ enhMapAutoRoute: false }));
        afterEach(() => overrideEnhancements({}));

        it('ignores a single shift-click on D-U-U-D', () => {
            const map = graph([ossory, vael]);
            let changes = 0;
            map.routeChanged.subscribe(() => changes++);
            map.clickSystem(vael, true);
            expect(map.getRouteState().pinned).toEqual([]);
            expect(map.getEffectiveRoute()).toEqual([]);
            expect(changes).toBe(0);
            // The click still inspects the system.
            expect(map.infoSystem).toBe(vael);
        });

        it('builds the same route pin by pin', () => {
            const map = graph([ossory, vael]);
            map.clickSystem(thessaly, true);
            map.clickSystem(vael, true);
            expect(map.getRouteState().pinned).toEqual([thessaly]);
            map.clickSystem(kestrel, true);
            map.clickSystem(vael, true);
            expect(map.getRouteState().pinned)
                .toEqual([thessaly, kestrel, vael]);
            expect(map.getEffectiveRoute()).toEqual([thessaly, kestrel, vael]);
        });
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
            // Clicking it again keeps it picked: in the original a
            // ctrl-click on the already-picked WSW left "Hyperspace Map
            // WSW" on the status bar (reference_experiments M1-M3).
            map.clickSystem(thessaly);
            expect(map.getEffectiveRoute()).toEqual([thessaly]);
            expect(changes).toBe(1);
        });

        it('treats shift-click as a plain click', () => {
            // The original picked WSW on a shift-click exactly as on a
            // plain one: no multi-jump pins from the minimap.
            const map = graph([ossory, thessaly, kestrel], true);
            map.clickSystem(thessaly, true);
            expect(map.getRouteState()).toEqual(
                { pinned: [], single: thessaly });
            expect(map.getEffectiveRoute()).toEqual([thessaly]);
        });

        it('clears the destination on a drag that starts on the current '
            + 'system', () => {
                const map = graph([ossory, thessaly], true);
                map.clickSystem(thessaly);
                let changes = 0;
                map.routeChanged.subscribe(() => changes++);
                // A drag from anywhere else does nothing.
                map.dragFromSystem(thessaly);
                expect(map.getEffectiveRoute()).toEqual([thessaly]);
                map.dragFromSystem(ossory);
                expect(map.hasRoute).toBeFalse();
                expect(changes).toBe(1);
            });

        it('does not clear the full map\'s route on a drag', () => {
            const map = graph([ossory, thessaly], false);
            map.clickSystem(thessaly);
            map.dragFromSystem(ossory);
            expect(map.getEffectiveRoute()).toEqual([thessaly]);
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

/**
 * The map's route is what JumpRouteComponent flies (Done ->
 * setPlayerJumpRoute). The sim knows nothing of the pilot's discovery
 * record, so a route through unexplored systems must fly exactly like any
 * other: one jump per hop, each hop a link of the system before it (the
 * DETERMINISM CONTRACT in route.ts), arriving in each unexplored system in
 * turn.
 */
describe('a D-U-U-D route plotted on the map, flown', () => {
    const SHIP_UUID = 'route through the unknown';

    it('jumps hop by hop through both unexplored systems', async () => {
        installHeadlessPixi();
        const gameData = await getSyntheticGameData();
        const systems = await Promise.all([thessaly, kestrel, ossory, vael]
            .map(id => gameData.data.System.get(id)));
        const map = new SystemGraph(systems, ossory,
            { discoveryOf: discoveryOf([ossory, vael]) });
        map.clickSystem(vael, true);
        const route = map.getEffectiveRoute();
        expect(route).toEqual([thessaly, kestrel, vael]);

        // An inertial hull, so every jump runs the full sequence.
        const ids = await gameData.ids;
        let shipData;
        for (const shipId of [...ids.Ship].sort()) {
            const candidate = await gameData.data.Ship.get(shipId);
            if (!candidate.physics.inertialess
                && !candidate.physics.canJumpWithoutSlowing) {
                shipData = candidate;
                break;
            }
        }
        if (!shipData) {
            throw new Error('Expected a ship with default jump behavior');
        }
        let world = await makeSystem(ossory, gameData, undefined,
            { npcs: false });
        let ship = makeShip(shipData);
        ship.components.set(PlayerShipSelector, undefined);
        ship.components.set(JumpRouteComponent, { route: [...route] });
        await completeEntity(world, ship);
        world.entities.set(SHIP_UUID, ship);
        // No multi-jump (that would fly the route as ONE jump): the jump
        // key is held through every arrival instead, and there is fuel for
        // the whole trip.
        const physics = ship.components.get(ShipPhysicsComponent)!;
        ship.components.set(ShipPhysicsComponent,
            { ...physics, multiJump: 0 });
        ship.components.get(MovementStateComponent)!.position =
            new Position(0, -(JUMP_DISTANCE * 2));
        world.step();
        const fuel = ship.components.get(FuelComponent)!;
        fuel.max = Math.max(fuel.max, FUEL_PER_JUMP * 3);
        fuel.current = fuel.max;
        applyControlEvents(world, undefined,
            [{ action: 'hyperjump', state: 'start' }]);
        world.step();

        const arrivals: string[] = [];
        let systemId = ossory;
        for (const hop of route) {
            const jump = ship.components.get(JumpComponent);
            expect(jump?.to).withContext(`the jump out of ${systemId}`)
                .toBe(hop);
            let finished: FinishJump | undefined;
            world.events.get(FinishJumpEvent).subscribe(({ data }) => {
                finished = data;
            });
            for (let i = 0; i < 3000 && finished === undefined; i++) {
                world.step();
            }
            expect(finished).withContext(`the jump to ${hop}`).toBeDefined();
            arrivals.push(finished!.to);
            // Every hop is a link of the system it leaves.
            expect((await gameData.data.System.get(systemId)).links)
                .toContain(finished!.to);

            world = await makeSystem(hop, gameData, undefined,
                { npcs: false });
            ship = finished!.entity;
            await completeEntity(world, ship);
            world.entities.set(SHIP_UUID, ship);
            systemId = hop;
            // The held key (browser key repeat) reaches the new system; the
            // first tick finishes the arrival, the second starts the
            // route's next jump.
            applyControlEvents(world, undefined,
                [{ action: 'hyperjump', state: 'repeat' }]);
            world.step();
            world.step();
        }
        expect(arrivals).toEqual([thessaly, kestrel, vael]);
        expect(ship.components.get(JumpRouteComponent)!.route).toEqual([]);
        expect(ship.components.get(JumpComponent)).toBeUndefined();
    }, 60_000);
});
