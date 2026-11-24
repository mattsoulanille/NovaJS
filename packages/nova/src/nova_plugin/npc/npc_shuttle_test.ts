import 'jasmine';
import { getDefaultGovtData, GovtData } from 'novadatainterface/govt_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import {
    getDefaultPlanetData, getDefaultPlanetFlags, PlanetData,
} from 'novadatainterface/planet_data';
import { getDefaultShipAIFlags, getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import { getDefaultSystemData } from 'novadatainterface/system_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { Random } from 'nova_ecs/plugins/random_plugin';
import {
    restoreWorld, snapshotWorld, SnapshotPoliciesResource,
} from 'nova_ecs/plugins/snapshot_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { hashWorld } from 'nova_ecs/plugins/world_hash';
import { World } from 'nova_ecs/world';
import { deriveEntityComponents, GovtComponent } from '../core/index.js';
import { makeSystem } from '../make_system.js';
import { makeShip } from '../ship/index.js';
import { completeEntity, takeOffState } from '../spawn/index.js';
import { JumpComponent } from '../travel/index.js';
import { NpcComponent, NpcState } from './npc_component.js';
import type { PlanetEntry } from './npc_decision.js';
import { friendlyStellar, isShuttle, shuttleStops } from './npc_shuttle.js';

/**
 * ============================================================================
 * In-system shuttles (shïp Flags3 0x0002 without a scoop) against the
 * reference: docs/reference_experiments.md "N2: in-system shuttles", wave
 * 13, in its own layout (sÿst 2089 Kit Shuttle Range): a port and a market
 * of the traders' govt, an uninhabited marker, and a hostile port of an
 * enemy govt. The control is the same hull without the flag (T1).
 * ============================================================================
 */

const TRADERS = 'test:traders';
const HOSTILE = 'test:hostile';
const SYSTEM = 'test:system';
const PORT = 'test:port';
const MARKET = 'test:market';
const MARKER = 'test:marker';
const HOSTILE_PORT = 'test:hostile-port';
const SHUTTLE_HULL = 'test:shuttle';
const TRADER_HULL = 'test:trader';

function govt(id: string, over: Partial<GovtData>): GovtData {
    return { ...getDefaultGovtData(), id, ...over };
}

function stellar(id: string, x: number, y: number,
    over: Partial<PlanetData> = {}): PlanetData {
    return { ...getDefaultPlanetData(), id, name: id, position: [x, y], ...over };
}

const LAYOUT: PlanetData[] = [
    stellar(PORT, 0, 0, { govt: TRADERS }),
    stellar(MARKET, 1000, 0, { govt: TRADERS }),
    stellar(MARKER, 0, 1000, {
        flags: { ...getDefaultPlanetFlags(), canLand: false, uninhabited: true },
    }),
    stellar(HOSTILE_PORT, -1000, 0, { govt: HOSTILE }),
];

function hull(id: string, shuttle: boolean): ShipData {
    const base = getDefaultShipData();
    return {
        ...base, id, name: id,
        aiFlags: {
            ...getDefaultShipAIFlags(),
            scoopsAsteroidDebris: shuttle,
            shuttlesBetweenStellars: shuttle,
        },
    };
}

async function shuttleWorld(layout: PlanetData[] = LAYOUT) {
    const gameData = new MockGameData();
    gameData.data.Govt.map.set(TRADERS,
        govt(TRADERS, { classes: [1], enemies: [2] }));
    gameData.data.Govt.map.set(HOSTILE,
        govt(HOSTILE, { classes: [2], enemies: [1] }));
    for (const planet of layout) {
        gameData.data.Planet.map.set(planet.id, planet);
    }
    gameData.data.Ship.map.set(SHUTTLE_HULL, hull(SHUTTLE_HULL, true));
    gameData.data.Ship.map.set(TRADER_HULL, hull(TRADER_HULL, false));
    gameData.data.System.map.set(SYSTEM, {
        ...getDefaultSystemData(), id: SYSTEM, govt: TRADERS,
        planets: layout.map(planet => planet.id),
    });
    const world = await makeSystem(SYSTEM, gameData, undefined,
        { npcs: false });

    async function addNpc(uuid: string, hullId: string, x: number, y: number,
        npc: Partial<NpcState> = {}) {
        const ship = makeShip(gameData.data.Ship.map.get(hullId)!);
        ship.components.set(MovementStateComponent, {
            accelerating: 0, position: new Position(x, y),
            rotation: new Angle(0), turnBack: false, turning: 0,
            velocity: new Vector(0, 0),
        });
        ship.components.set(GovtComponent, { id: TRADERS });
        ship.components.set(NpcComponent, { aiType: 1, ...npc });
        await completeEntity(world, ship);
        world.entities.set(uuid, ship);
        return ship;
    }
    return { world, gameData, addNpc };
}

/** The uuid of the stellar made from `planetId` (makePlanet names the
 * entity after the stellar, and `stellar` names it by its id). */
function stellarUuid(world: World, planetId: string): string {
    for (const [uuid, entity] of world.entities) {
        if (entity.name === planetId) {
            return uuid;
        }
    }
    throw new Error(`no stellar ${planetId}`);
}

function now(world: World) {
    return world.resources.get(TimeResource)!.time;
}

/**
 * Steps `world` for `seconds`, calling `each` after every step with the
 * ship's NpcState (undefined once it is gone).
 */
function runFor(world: World, uuid: string, seconds: number,
    each: (npc: NpcState | undefined) => void = () => { }) {
    const end = now(world) + seconds * 1000;
    while (now(world) < end) {
        world.step();
        each(world.entities.get(uuid)?.components.get(NpcComponent));
    }
}

describe('In-system shuttles (shïp Flags3 0x0002 without a scoop)', () => {
    it('tells a shuttle hull from a trader by the parsed flag', () => {
        expect(isShuttle(hull(SHUTTLE_HULL, true))).toBeTrue();
        expect(isShuttle(hull(TRADER_HULL, false))).toBeFalse();
    });

    describe('shuttleStops', () => {
        const traders = govt(TRADERS, { classes: [1], enemies: [2] });
        const govts = new Map([
            [TRADERS, traders],
            [HOSTILE, govt(HOSTILE, { classes: [2], enemies: [1] })],
        ]);
        const entries = (layout: PlanetData[]): PlanetEntry[] =>
            layout.map(data => [data.id, {
                position: new Position(...data.position),
            } as never, undefined, data] as const);

        it('keeps own-govt and independent stellars, the uninhabited, '
            + 'non-landable marker included, and drops the enemy\'s', () => {
                expect(shuttleStops(entries(LAYOUT), traders,
                    id => govts.get(id)).map(([id]) => id))
                    .toEqual([PORT, MARKET, MARKER]);
            });

        it('drops hypergates and wormholes (guess)', () => {
            const gate = stellar('test:gate', 500, 500, {
                gate: { kind: 'hypergate', destinations: [], emergenceAngle: null },
            });
            const wormhole = stellar('test:wormhole', 500, -500, {
                gate: { kind: 'wormhole', destinations: [], emergenceAngle: null },
            });
            expect(shuttleStops(entries([...LAYOUT, gate, wormhole]),
                traders, id => govts.get(id)).map(([id]) => id))
                .toEqual([PORT, MARKET, MARKER]);
        });

        it('an independent shuttle stops anywhere but a gate', () => {
            expect(friendlyStellar(undefined, HOSTILE, id => govts.get(id)))
                .toBeTrue();
            expect(shuttleStops(entries(LAYOUT), undefined,
                id => govts.get(id)).length).toBe(4);
        });
    });

    it('shuttles between the friendly stellars, the marker included, '
        + 'never visits the enemy port and never jumps (N2)', async () => {
            const { world, addNpc } = await shuttleWorld();
            // Stays far longer than this run: no landing here.
            await addNpc('shuttle', SHUTTLE_HULL, 0, 0,
                { departAt: Number.MAX_SAFE_INTEGER });
            const visited = new Set<string>();
            let jumped = false;
            runFor(world, 'shuttle', 600, npc => {
                if (npc?.mode === 'dwell' && npc.destination) {
                    visited.add(world.entities.get(npc.destination)!.name ?? '');
                }
                jumped ||= npc?.mode === 'depart'
                    || world.entities.get('shuttle')!.components
                        .has(JumpComponent);
            });
            expect(jumped).toBeFalse();
            expect(world.entities.has('shuttle')).toBeTrue();
            expect(visited.has(HOSTILE_PORT)).toBeFalse();
            expect([...visited].sort()).toEqual([MARKER, MARKET, PORT].sort());
        });

    it('lands at the end of a stop when its stay is up instead of '
        + 'jumping out (guess)', async () => {
            const { world, addNpc } = await shuttleWorld();
            await addNpc('shuttle', SHUTTLE_HULL, 0, 0, { departAt: 0 });
            let jumped = false;
            let lastMode: string | undefined;
            let lastPosition: Position | undefined;
            runFor(world, 'shuttle', 60, npc => {
                const ship = world.entities.get('shuttle');
                jumped ||= npc?.mode === 'depart'
                    || (ship?.components.has(JumpComponent) ?? false);
                if (npc) {
                    lastMode = npc.mode;
                    lastPosition = Position.fromVectorLike(ship!.components
                        .get(MovementStateComponent)!.position);
                }
            });
            expect(world.entities.has('shuttle')).toBeFalse();
            expect(jumped).toBeFalse();
            // Gone from a stop, beside one of its stellars.
            expect(lastMode).toBe('dwell');
            const nearest = Math.min(...LAYOUT
                .filter(planet => planet.id !== HOSTILE_PORT)
                .map(planet => lastPosition!.subtract(
                    new Position(...planet.position)).length));
            expect(nearest).toBeLessThan(100);
        });

    it('the control trader (no flag) jumps out when its stay is up (T1)',
        async () => {
            const { world, addNpc } = await shuttleWorld();
            await addNpc('trader', TRADER_HULL, 0, 0, { departAt: 0 });
            let jumped = false;
            runFor(world, 'trader', 60, () => {
                jumped ||= world.entities.get('trader')?.components
                    .has(JumpComponent) ?? false;
            });
            expect(jumped).toBeTrue();
        });

    it('with a single stop, goes back to it rather than leave', async () => {
        const { world, addNpc } = await shuttleWorld([
            stellar(PORT, 0, 0, { govt: TRADERS }),
            stellar(HOSTILE_PORT, -1000, 0, { govt: HOSTILE }),
        ]);
        await addNpc('shuttle', SHUTTLE_HULL, 300, 0,
            { departAt: Number.MAX_SAFE_INTEGER });
        const port = stellarUuid(world, PORT);
        const destinations = new Set<string | undefined>();
        runFor(world, 'shuttle', 60, npc => {
            destinations.add(npc?.destination);
            expect(npc?.mode).not.toBe('depart');
        });
        expect(world.entities.has('shuttle')).toBeTrue();
        expect([...destinations].filter(d => d !== undefined)).toEqual([port]);
    });

    it('a respawned shuttle takes off from a stop, at rest', async () => {
        const { world, gameData } = await shuttleWorld();
        const stops = new Set([PORT, MARKET, MARKER].map(id => {
            const [x, y] = LAYOUT.find(planet => planet.id === id)!.position;
            return `${x},${y}`;
        }));
        const random = new Random(7);
        for (let i = 0; i < 20; i++) {
            const state = takeOffState(world, gameData, TRADERS, random)!;
            expect(stops.has(`${state.position.x},${state.position.y}`))
                .withContext(`${state.position.x},${state.position.y}`)
                .toBeTrue();
            expect(state.velocity.length).toBe(0);
        }
    });

    it('a shuttle with no stop here falls back to a jump-in', async () => {
        const { world, gameData } = await shuttleWorld([
            stellar(HOSTILE_PORT, -1000, 0, { govt: HOSTILE }),
        ]);
        expect(takeOffState(world, gameData, TRADERS, new Random(1)))
            .toBeUndefined();
    });

    it('replays identically after a rollback', async () => {
        const { world, addNpc } = await shuttleWorld();
        await addNpc('shuttle', SHUTTLE_HULL, 0, 0,
            { departAt: Number.MAX_SAFE_INTEGER });
        await addNpc('leaver', SHUTTLE_HULL, 1000, 0, { departAt: 20_000 });
        world.step();
        const before = snapshotWorld(world);
        const record = () => {
            const hashes: string[] = [];
            for (let i = 0; i < 1800; i++) {
                world.step();
                hashes.push(hashWorld(world).hash);
            }
            return hashes;
        };
        const first = record();
        expect(world.entities.has('leaver')).toBeFalse();
        restoreWorld(world, before, deriveEntityComponents);
        expect(world.entities.has('leaver')).toBeTrue();
        expect(record()).toEqual(first);
        const policies = world.resources.get(SnapshotPoliciesResource)!;
        expect([...policies.unhandled]).toEqual([]);
    });
});
