import 'jasmine';
import { getDefaultGovtData, GovtData } from 'novadatainterface/govt_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import {
    getDefaultPlanetData, getDefaultPlanetFlags, PlanetData,
} from 'novadatainterface/planet_data';
import { getDefaultShipAIFlags, getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import { getDefaultDudeData } from 'novadatainterface/dude_data';
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
import {
    deriveEntityComponents, GovtComponent, IdFactory,
} from '../core/index.js';
import { makeSystem } from '../make_system.js';
import { makeShip, ShipDataComponent } from '../ship/index.js';
import { completeEntity, spawnNpc } from '../spawn/index.js';
import { JUMP_DISTANCE, JumpComponent } from '../travel/index.js';
import { NpcComponent, NpcState } from './npc_component.js';
import type { PlanetEntry } from './npc_decision.js';
import { traderDestinations } from './npc_decision.js';
import {
    friendlyStellar, isShuttle, SHUTTLE_DWELL_MS, SHUTTLE_TURN_DISTANCE,
    shuttleLaneEnd, shuttleStops, shuttleTurnPoint,
} from './npc_shuttle.js';
import { TRADER_DWELL_MS } from './npc_steering.js';

/**
 * ============================================================================
 * In-system shuttles (shïp Flags3 0x0002 without a scoop) against the
 * reference: docs/reference_experiments.md "N2: in-system shuttles", wave
 * 13, in its own layout (sÿst 2089 Kit Shuttle Range): a port and a market
 * of the traders' govt, an uninhabited marker, and a hostile port of an
 * enemy govt. The control is the same hull without the flag (T1).
 *
 * And "Shuttles and T1 traders, wave 15", in ITS layout (sÿst 1500 Kit
 * Square Range, SQUARE below): five stellars 220 px apart, listed Hostile
 * (enemy), Market (own), Port (own), Neutral (a neutral govt's), Marker
 * (uninhabited). Shuttles never land or leave, keep one lane, turn 70 px
 * short after about 4 s; traders park about 15 s at ONE non-enemy port and
 * leave.
 * ============================================================================
 */

const TRADERS = 'test:traders';
const HOSTILE = 'test:hostile';
const NEUTRAL = 'test:neutral';
const NEUTRAL_PORT = 'test:neutral-port';
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

/** Wave 15's square, in its sÿst list order. */
const SQUARE: PlanetData[] = [
    stellar(HOSTILE_PORT, 220, 220, { govt: HOSTILE }),
    stellar(MARKET, 220, 0, { govt: TRADERS }),
    stellar(PORT, 0, 0, { govt: TRADERS }),
    stellar(NEUTRAL_PORT, 0, 220, { govt: NEUTRAL }),
    stellar(MARKER, -220, 0, {
        flags: { ...getDefaultPlanetFlags(), canLand: false, uninhabited: true },
    }),
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

const GOVTS = new Map([
    [TRADERS, govt(TRADERS, { classes: [1], enemies: [2] })],
    [HOSTILE, govt(HOSTILE, { classes: [2], enemies: [1] })],
    [NEUTRAL, govt(NEUTRAL, { classes: [3] })],
]);

/**
 * A world of `layout`. With `traffic`, the system has that AvgShips of one
 * AI 1 düde of TRADERS flying the shuttle and the trader hull at equal
 * odds (wave 15's rig), and makeSystem populates it.
 */
async function shuttleWorld(layout: PlanetData[] = LAYOUT, traffic?: number) {
    const gameData = new MockGameData();
    for (const [id, data] of GOVTS) {
        gameData.data.Govt.map.set(id, data);
    }
    for (const planet of layout) {
        gameData.data.Planet.map.set(planet.id, planet);
    }
    gameData.data.Ship.map.set(SHUTTLE_HULL, hull(SHUTTLE_HULL, true));
    gameData.data.Ship.map.set(TRADER_HULL, hull(TRADER_HULL, false));
    const DUDE = 'test:dude';
    gameData.data.Dude.map.set(DUDE, {
        ...getDefaultDudeData(), id: DUDE, aiType: 1, govt: TRADERS,
        ships: [{ id: SHUTTLE_HULL, weight: 50 },
            { id: TRADER_HULL, weight: 50 }],
    });
    gameData.data.System.map.set(SYSTEM, {
        ...getDefaultSystemData(), id: SYSTEM, govt: TRADERS,
        planets: layout.map(planet => planet.id),
        ...(traffic !== undefined ? {
            avgShips: traffic, dudes: [{ id: DUDE, weight: 100 }],
        } : {}),
    });
    const world = await makeSystem(SYSTEM, gameData, undefined,
        { npcs: traffic !== undefined });

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


    const entries = (layout: PlanetData[]): PlanetEntry[] =>
        layout.map(data => [data.id, {
            position: new Position(...data.position),
        } as never, undefined, data] as const);
    const govtOf = (id: string) => GOVTS.get(id);
    const traders = GOVTS.get(TRADERS)!;

    /** A Random that counts its draws. */
    function countingRandom(seed: number) {
        const random = new Random(seed);
        let draws = 0;
        const next = random.next.bind(random);
        random.next = () => {
            draws++;
            return next();
        };
        return { random, draws: () => draws };
    }

    describe('the lane (wave 15)', () => {
        const stops = shuttleStops(entries(SQUARE), traders, govtOf);

        it('a stop\'s lane runs to its nearest other stop, with no draw',
            () => {
                for (const from of [MARKET, NEUTRAL_PORT, MARKER]) {
                    const { random, draws } = countingRandom(1);
                    expect(shuttleLaneEnd(stops, from, random))
                        .withContext(from).toBe(PORT);
                    expect(draws()).toBe(0);
                }
            });

        it('a tie (the Port: three neighbours 220 px out) is one draw '
            + 'among them, so every lane seen in the rig joins the Port',
            () => {
                const ends = new Set<string>();
                for (let seed = 1; seed <= 40; seed++) {
                    const { random, draws } = countingRandom(seed);
                    ends.add(shuttleLaneEnd(stops, PORT, random));
                    expect(draws()).toBe(1);
                }
                expect([...ends].sort())
                    .toEqual([MARKER, MARKET, NEUTRAL_PORT].sort());
            });

        it('a lone stop is its own lane end', () => {
            const { random, draws } = countingRandom(1);
            const lone = shuttleStops(entries([SQUARE[2]!]), traders, govtOf);
            expect(shuttleLaneEnd(lone, PORT, random)).toBe(PORT);
            expect(draws()).toBe(0);
        });

        it('turns 70 px short of the centre, towards the other end',
            () => {
                const origin = new Position(0, 0);
                const turn = shuttleTurnPoint(origin, new Position(220, 0),
                    new Position(-900, 900));
                expect(turn.x).toBeCloseTo(SHUTTLE_TURN_DISTANCE, 6);
                expect(turn.y).toBeCloseTo(0, 6);
                // Two close stops: half way at most.
                const close = shuttleTurnPoint(origin, new Position(0, 100),
                    new Position(500, 0));
                expect(close.y).toBeCloseTo(50, 6);
                // No other end: on the shuttle's side.
                const alone = shuttleTurnPoint(origin, undefined,
                    new Position(0, -500));
                expect(alone.y).toBeCloseTo(-SHUTTLE_TURN_DISTANCE, 6);
            });
    });

    it('keeps one lane between the Port and a neighbour, turning about '
        + '70 px short of each centre after about 4 s; never the enemy '
        + 'port; never lands or leaves, its stay long up (wave 15)',
        async () => {
            const { world, addNpc } = await shuttleWorld(SQUARE);
            await addNpc('shuttle', SHUTTLE_HULL, -900, 900, { departAt: 0 });
            const position = (uuid: string) => Position.fromVectorLike(
                world.entities.get(uuid)!.components
                    .get(MovementStateComponent)!.position);
            const stops: string[] = [];
            const turnDistances: number[] = [];
            const dwells: number[] = [];
            let dwellStart: number | undefined;
            let left = false;
            runFor(world, 'shuttle', 400, npc => {
                const ship = world.entities.get('shuttle');
                left ||= !ship || npc?.mode === 'depart'
                    || ship.components.has(JumpComponent);
                if (npc?.mode === 'dwell' && dwellStart === undefined) {
                    dwellStart = now(world);
                    stops.push(world.entities.get(npc.destination!)!.name!);
                    turnDistances.push(position('shuttle')
                        .subtract(position(npc.destination!)).length);
                } else if (npc?.mode !== 'dwell' && dwellStart !== undefined) {
                    dwells.push(now(world) - dwellStart);
                    dwellStart = undefined;
                }
            });
            expect(left).toBeFalse();
            expect(world.entities.has('shuttle')).toBeTrue();
            expect(stops.length).toBeGreaterThan(10);
            // Two stops, one of them the Port, strictly alternating.
            const lane = [...new Set(stops)].sort();
            expect(lane.length).toBe(2);
            expect(lane).toContain(PORT);
            expect(lane).not.toContain(HOSTILE_PORT);
            for (let i = 1; i < stops.length; i++) {
                expect(stops[i]).not.toBe(stops[i - 1]!);
            }
            // The turn: about 70 px out (within the 30 px arrival).
            for (const d of turnDistances.slice(1)) {
                expect(d).toBeGreaterThan(SHUTTLE_TURN_DISTANCE - 30);
                expect(d).toBeLessThan(SHUTTLE_TURN_DISTANCE + 30);
            }
            // The pause: 4 s, to the next think.
            for (const d of dwells) {
                expect(d).toBeGreaterThanOrEqual(SHUTTLE_DWELL_MS);
                expect(d).toBeLessThan(SHUTTLE_DWELL_MS + 1100);
            }
        }, 120_000);

    it('N2\'s layout: shuttles between the friendly stellars, never the '
        + 'enemy port, never jumps', async () => {
            const { world, addNpc } = await shuttleWorld();
            await addNpc('shuttle', SHUTTLE_HULL, 0, 0,
                { departAt: Number.MAX_SAFE_INTEGER });
            const visited = new Set<string>();
            let jumped = false;
            runFor(world, 'shuttle', 300, npc => {
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
            expect(visited.size).toBe(2);
        }, 120_000);

    it('resumes its lane after a flight', async () => {
        const { world, addNpc } = await shuttleWorld(SQUARE);
        const ship = await addNpc('shuttle', SHUTTLE_HULL, 0, -300,
            { departAt: Number.MAX_SAFE_INTEGER });
        runFor(world, 'shuttle', 5);
        const npc = ship.components.get(NpcComponent)!;
        const lane = [npc.destination, npc.laneEnd];
        expect(lane[0]).toBeDefined();
        expect(lane[1]).toBeDefined();
        // Frightened off and back: the decision re-plans from no mode.
        npc.mode = undefined;
        npc.nextDecision = 0;
        world.step();
        expect(npc.mode as string | undefined).toBe('travel');
        expect([npc.destination, npc.laneEnd]).toEqual(lane);
    }, 60_000);

    it('with a single stop, goes back to it rather than leave', async () => {
        const { world, addNpc } = await shuttleWorld([
            stellar(PORT, 0, 0, { govt: TRADERS }),
            stellar(HOSTILE_PORT, -1000, 0, { govt: HOSTILE }),
        ]);
        await addNpc('shuttle', SHUTTLE_HULL, 300, 0, { departAt: 0 });
        const port = stellarUuid(world, PORT);
        const destinations = new Set<string | undefined>();
        let dwelt = 0;
        runFor(world, 'shuttle', 60, npc => {
            destinations.add(npc?.destination);
            dwelt += npc?.mode === 'dwell' ? 1 : 0;
            expect(npc?.mode).not.toBe('depart');
        });
        expect(world.entities.has('shuttle')).toBeTrue();
        expect(dwelt).toBeGreaterThan(0);
        expect([...destinations].filter(d => d !== undefined)).toEqual([port]);
    }, 60_000);

    it('a respawned shuttle jumps in at the edge like any traffic '
        + '(wave 15)', async () => {
            const { world, gameData } = await shuttleWorld(SQUARE);
            // Staged, as genesis stages every class the table can spawn.
            await gameData.data.Ship.get(SHUTTLE_HULL);
            const before = new Set(world.entities.keys());
            for (let i = 0; i < 5; i++) {
                spawnNpc(world, gameData, new IdFactory(`t${i}`),
                    new Random(i + 1), [{
                        weight: 1, dude: {
                            aiType: 1, govt: TRADERS,
                            ships: [{ id: SHUTTLE_HULL, weight: 1 }],
                        },
                    }], true);
            }
            const spawned = [...world.entities].filter(([uuid]) =>
                !before.has(uuid));
            expect(spawned.length).toBe(5);
            for (const [, entity] of spawned) {
                const movement = entity.components.get(MovementStateComponent)!;
                expect(movement.position.length)
                    .toBeGreaterThan(JUMP_DISTANCE);
                expect(movement.velocity.length).toBeGreaterThan(0);
            }
        });

    describe('T1 traders (the control hull, wave 15)', () => {
        it('stop only at the own and the neutral govt\'s ports: never the '
            + 'enemy\'s, never the uninhabited marker', () => {
                expect(traderDestinations(entries(SQUARE), traders, govtOf)
                    .map(([id]) => id).sort())
                    .toEqual([MARKET, NEUTRAL_PORT, PORT].sort());
            });

        it('spread their stops evenly over those ports', async () => {
            const { world, addNpc } = await shuttleWorld(SQUARE);
            for (let i = 0; i < 90; i++) {
                await addNpc(`trader ${i}`, TRADER_HULL, -900, 900 + i);
            }
            world.step();
            const counts = new Map<string, number>();
            for (let i = 0; i < 90; i++) {
                const destination = world.entities.get(`trader ${i}`)!
                    .components.get(NpcComponent)!.destination!;
                const name = world.entities.get(destination)!.name!;
                counts.set(name, (counts.get(name) ?? 0) + 1);
            }
            expect([...counts.keys()].sort())
                .toEqual([MARKET, NEUTRAL_PORT, PORT].sort());
            for (const count of counts.values()) {
                expect(count).toBeGreaterThan(15);
            }
        }, 60_000);

        it('park about 15 s beside ONE port and then jump out, whatever '
            + 'their departure roll', async () => {
                const { world, addNpc } = await shuttleWorld(SQUARE);
                await addNpc('trader', TRADER_HULL, -900, 900,
                    { departAt: Number.MAX_SAFE_INTEGER });
                const stops: string[] = [];
                let dwellStart: number | undefined;
                let dwell: number | undefined;
                let modeAfter: string | undefined;
                let jumped = false;
                runFor(world, 'trader', 150, npc => {
                    const ship = world.entities.get('trader');
                    jumped ||= ship?.components.has(JumpComponent) ?? false;
                    if (npc?.mode === 'dwell' && dwellStart === undefined) {
                        dwellStart = now(world);
                        stops.push(world.entities.get(npc.destination!)!.name!);
                    } else if (npc && npc.mode !== 'dwell'
                        && dwellStart !== undefined && dwell === undefined) {
                        dwell = now(world) - dwellStart;
                        modeAfter = npc.mode;
                    }
                });
                expect(stops.length).toBe(1);
                expect([MARKET, NEUTRAL_PORT, PORT]).toContain(stops[0]!);
                expect(modeAfter).toBe('depart');
                expect(dwell).toBeGreaterThanOrEqual(TRADER_DWELL_MS);
                expect(dwell!).toBeLessThan(TRADER_DWELL_MS + 1100);
                expect(TRADER_DWELL_MS).toBe(15_000);
                expect(jumped).toBeTrue();
                expect(world.entities.has('trader')).toBeFalse();
            }, 120_000);
    });

    it('shuttles fill the system: once every trader has left, the '
        + 'shuttles hold every traffic slot (wave 15, finding 2)',
        async () => {
            const { world } = await shuttleWorld(SQUARE, 6);
            const census = () => {
                let shuttles = 0;
                let others = 0;
                for (const [, entity] of world.entities) {
                    if (!entity.components.has(NpcComponent)) {
                        continue;
                    }
                    const ship = entity.components.get(ShipDataComponent);
                    if (ship && isShuttle(ship)) {
                        shuttles++;
                    } else {
                        others++;
                    }
                }
                return { shuttles, others };
            };
            let filledAt: number | undefined;
            const start = now(world);
            let last = census();
            while (now(world) - start < 15 * 60_000) {
                world.step();
                last = census();
                if (last.others === 0 && filledAt === undefined) {
                    filledAt = now(world) - start;
                } else if (last.others > 0) {
                    filledAt = undefined;
                }
            }
            expect(filledAt).withContext('never filled').toBeDefined();
            expect(last.others).toBe(0);
            expect(last.shuttles).toBeGreaterThan(0);
        }, 300_000);

    it('replays identically after a rollback', async () => {
        const { world, addNpc } = await shuttleWorld(SQUARE);
        await addNpc('shuttle', SHUTTLE_HULL, 0, 0, { departAt: 0 });
        await addNpc('leaver', TRADER_HULL, 220, 0, { departAt: 0 });
        world.step();
        const before = snapshotWorld(world);
        const record = () => {
            const hashes: string[] = [];
            for (let i = 0; i < 3600; i++) {
                world.step();
                hashes.push(hashWorld(world).hash);
            }
            return hashes;
        };
        const first = record();
        expect(world.entities.has('leaver')).toBeFalse();
        expect(world.entities.has('shuttle')).toBeTrue();
        restoreWorld(world, before, deriveEntityComponents);
        expect(world.entities.has('leaver')).toBeTrue();
        expect(record()).toEqual(first);
        const policies = world.resources.get(SnapshotPoliciesResource)!;
        expect([...policies.unhandled]).toEqual([]);
    }, 120_000);
});
