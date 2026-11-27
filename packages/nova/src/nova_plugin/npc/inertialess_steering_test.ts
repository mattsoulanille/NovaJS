import 'jasmine';
import { getDefaultGovtData } from 'novadatainterface/govt_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultPlanetData } from 'novadatainterface/planet_data';
import {
    getDefaultShipAIFlags, getDefaultShipData, ShipData,
} from 'novadatainterface/ship_data';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import {
    MovementPhysicsComponent, MovementState, MovementStateComponent,
    MovementType,
} from 'nova_ecs/plugins/movement_plugin';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { World } from 'nova_ecs/world';
import {
    getIntegrationGameData, getSyntheticGameData,
} from '../../communication/simulation_test_fixture.js';
import { GovtComponent } from '../core/index.js';
import {
    BayFighterComponent, EscortLandedEvent, ESCORT_ATTACK_STANDOFF,
    ESCORT_LAND_DISTANCE_SQUARED, ESCORT_LAND_SPEED_SQUARED, ReturnComponent,
} from '../escorts/index.js';
import { makeSystem, SIMULATION_STEP_MS } from '../make_system.js';
import {
    ControlledByComponent, EscortCommandComponent, EscortLandingComponent,
    NO_DEAL, PlayerEscortComponent,
} from '../player/index.js';
import {
    FiringGroupComponent, makeShip, ShipPhysicsComponent, TargetComponent,
    WeaponsStateComponent,
} from '../ship/index.js';
import { completeEntity } from '../spawn/index.js';
import { PlanetComponent, PlanetDataComponent } from '../travel/index.js';
import { FormationComponent } from './npc_formation.js';
import { NpcComponent } from './npc_component.js';
import {
    RETREAT_STANDOFF_HOLD_SPEED, RETREAT_STANDOFF_MAX, RETREAT_STANDOFF_MIN,
} from './npc_retreat.js';
import { STANDOFF_HULL_BAND, STANDOFF_HULL_DISTANCE } from './npc_steering.js';

/**
 * ============================================================================
 * Inertialess hulls arrive, stop and dock on every AI steering path
 * ============================================================================
 *
 * An inertialess hull's velocity is its heading times a throttled
 * targetSpeed (movement_plugin's inertialessControls): it keeps its speed
 * until it brakes (reference "U9 and the inertialess hulls"). Every AI
 * steering path but formation keeping (e5e86ddd) flew it with the inertial
 * idioms, which only ever set `accelerating` to 0 or 1, so it never
 * slowed: an NPC trader never parked at its planet, a standoff hull
 * never held its band, an escort on attack flew through its victim and
 * circled it at top speed, one told to hold position never stopped, and
 * a slow landing escort starting from rest crept along on RCS nudges its
 * integrator undid, never reaching the landing window. These fly the real
 * MovementSystem at 60 Hz with the stock inertialess hulls' figures (shïp
 * Speed/Accel/Turn converted, as parsed from the base data).
 */

interface Hull {
    name: string, speed: number, acceleration: number, turnRate: number,
}

/** The stock inertialess hulls (base data, nova:NNN), as ShipPhysics. */
const HULLS: Hull[] = [
    { name: 'Vell-os Dart (nova:173)', speed: 270, acceleration: 225,
        turnRate: 5.235987755982989 },
    { name: 'Vell-os Arrow (nova:174)', speed: 191.25, acceleration: 117,
        turnRate: 3.1415926535897936 },
    { name: 'Vell-os Javelin (nova:175)', speed: 168.75, acceleration: 90,
        turnRate: 2.0943951023931957 },
    { name: 'Raven (nova:164)', speed: 101.25, acceleration: 63,
        turnRate: 2.0943951023931957 },
    { name: 'Wraith Adult (nova:185)', speed: 153, acceleration: 79.2,
        turnRate: 1.5707963267948968 },
    { name: 'Wraith Child (nova:170)', speed: 202.5, acceleration: 121.5,
        turnRate: 4.188790204786391 },
    { name: 'Hyperioid (nova:171)', speed: 90, acceleration: 45,
        turnRate: 1.5707963267948968 },
    { name: 'Striker (nova:271)', speed: 148.5, acceleration: 108,
        turnRate: 3.6651914291880923 },
    { name: 'Krypt Pod (nova:176)', speed: 270, acceleration: 234,
        turnRate: 6.806784082777885 },
];

const GOVT = 'test:govt';
const GOAL = 'goal';
const SHIP = 'ship';
const TICKS_PER_S = 1000 / SIMULATION_STEP_MS;

function hullData(h: Hull, id = 'test:hull',
    aiFlags = getDefaultShipAIFlags()): ShipData {
    const base = getDefaultShipData();
    return {
        ...base, id, aiFlags,
        physics: {
            ...base.physics, speed: h.speed, acceleration: h.acceleration,
            turnRate: h.turnRate, inertialess: true,
        },
    };
}

function at(entity: Entity): MovementState {
    return entity.components.get(MovementStateComponent)!;
}

function still(position: Position): MovementState {
    return {
        position, velocity: new Vector(0, 0), rotation: new Angle(0),
        accelerating: 0, turning: 0, turnBack: false,
    };
}

/**
 * Two starts: at rest facing the goal, and flying ACROSS the line to it at
 * top speed (a ship that was doing something else when it was sent off).
 * An inertialess hull's targetSpeed is what it keeps, so the moving start
 * sets that too.
 */
type Start = 'at rest' | 'flying past at top speed';
const STARTS: Start[] = ['at rest', 'flying past at top speed'];

function place(movement: MovementState, h: Hull, from: Position,
    goal: Position, start: Start) {
    const bearing = goal.subtract(from).angle;
    movement.position = from;
    movement.turnTo = null;
    movement.turning = 0;
    movement.accelerating = 0;
    if (start === 'at rest') {
        movement.rotation = bearing;
        movement.velocity = new Vector(0, 0);
        movement.targetSpeed = 0;
    } else {
        const across = bearing.add(Math.PI / 2);
        movement.rotation = across;
        movement.velocity = across.getUnitVector().scale(h.speed);
        movement.targetSpeed = h.speed;
    }
}

/** A system of one MockGameData hull and a still goal at the origin. */
async function mockWorld(h: Hull, aiFlags = getDefaultShipAIFlags()) {
    const gameData = new MockGameData();
    const hull = hullData(h, 'test:hull', aiFlags);
    gameData.data.Ship.map.set(hull.id, hull);
    gameData.data.Govt.map.set(GOVT, { ...getDefaultGovtData(), id: GOVT });
    await gameData.data.Ship.get(hull.id);
    const world = await makeSystem('test:system', gameData, undefined,
        { npcs: false });
    const goal = new Entity();
    goal.components.set(MovementStateComponent, still(new Position(0, 0)));
    world.entities.set(GOAL, goal);
    return { world, hull, gameData };
}

async function addHull(world: World, hull: ShipData, uuid: string,
    setup: (ship: Entity) => void) {
    const ship = makeShip(hull);
    ship.components.set(GovtComponent, { id: GOVT });
    setup(ship);
    await completeEntity(world, ship);
    world.entities.set(uuid, ship);
    world.step();
    expect(ship.components.get(MovementPhysicsComponent)?.movementType)
        .toBe(MovementType.INERTIALESS);
    return ship;
}

function speedOf(movement: MovementState) {
    return Vector.fromVectorLike(movement.velocity).length;
}

function distanceTo(movement: MovementState, point: Position) {
    return point.subtract(movement.position).length;
}

describe('An inertialess NPC', () => {
    for (const h of HULLS) {
        for (const start of STARTS) {
            it(`${h.name}, ${start}: flies in to its planet, parks within `
                + '30 s and then sits still', async () => {
                    const { world, hull } = await mockWorld(h);
                    const ship = await addHull(world, hull, SHIP, ship => {
                        // Travelling with no re-plan or departure due
                        // inside the spec.
                        ship.components.set(NpcComponent, {
                            aiType: 1, mode: 'travel', destination: GOAL,
                            nextDecision: 1e9, departAt: 1e9,
                        });
                    });
                    const goal = new Position(0, 0);
                    place(at(ship), h, new Position(700, -300), goal, start);
                    const npc = ship.components.get(NpcComponent)!;
                    // The settling step in addHull may already have parked
                    // it wherever it was spawned.
                    npc.mode = 'travel';
                    delete npc.until;
                    let ticks = 0;
                    while (npc.mode === 'travel' && ticks < 30 * TICKS_PER_S) {
                        world.step();
                        ticks++;
                    }
                    const arrival = `after ${ticks / TICKS_PER_S} s, `
                        + `${distanceTo(at(ship), goal).toFixed(0)} px out at `
                        + `${speedOf(at(ship)).toFixed(0)} px/s`;
                    expect(npc.mode).withContext(arrival).toBe('dwell');
                    // Parked: stopped within 3 s, and it stays put.
                    for (let i = 0; i < 3 * TICKS_PER_S; i++) {
                        world.step();
                    }
                    const parked = Position.fromVectorLike(at(ship).position);
                    expect(speedOf(at(ship))).toBeLessThan(1);
                    for (let i = 0; i < 5 * TICKS_PER_S; i++) {
                        world.step();
                    }
                    expect(parked.subtract(at(ship).position).length)
                        .toBeLessThan(2);
                    expect(distanceTo(at(ship), goal)).withContext(arrival)
                        .toBeLessThan(150);
                });
        }

        it(`${h.name}: a standoff hull (Flags2 0x0002) holds still in its `
            + 'band off its target, nose on it', async () => {
                const { world, hull } = await mockWorld(h,
                    { ...getDefaultShipAIFlags(), prefersStandoff: true });
                const ship = await addHull(world, hull, SHIP, ship => {
                    ship.components.set(NpcComponent, {
                        aiType: 3, mode: 'attack', nextDecision: 1e9,
                        departAt: 1e9,
                    });
                    ship.components.set(TargetComponent, { target: GOAL });
                });
                const goal = new Position(0, 0);
                place(at(ship), h, new Position(1200, 300), goal,
                    'flying past at top speed');
                for (let i = 0; i < 30 * TICKS_PER_S; i++) {
                    world.step();
                }
                let near = Infinity;
                let far = 0;
                let fastest = 0;
                for (let i = 0; i < 10 * TICKS_PER_S; i++) {
                    world.step();
                    const d = distanceTo(at(ship), goal);
                    near = Math.min(near, d);
                    far = Math.max(far, d);
                    fastest = Math.max(fastest, speedOf(at(ship)));
                }
                const context = `held ${near.toFixed(0)}-${far.toFixed(0)} px `
                    + `at up to ${fastest.toFixed(0)} px/s`;
                expect(near).withContext(context).toBeGreaterThan(
                    STANDOFF_HULL_DISTANCE - 2 * STANDOFF_HULL_BAND);
                expect(far).withContext(context).toBeLessThan(
                    STANDOFF_HULL_DISTANCE + 2 * STANDOFF_HULL_BAND);
                expect(fastest).withContext(context).toBeLessThan(1);
                const bearing = goal.subtract(at(ship).position).angle;
                expect(Math.abs(at(ship).rotation.distanceTo(bearing).angle))
                    .toBeLessThan(0.05);
            });

        it(`${h.name}: a losing gövt 0x0010 warship holds its retreat band`,
            async () => {
                const { world, hull } = await mockWorld(h);
                const ship = await addHull(world, hull, SHIP, ship => {
                    ship.components.set(NpcComponent, {
                        aiType: 3, mode: 'attack', nextDecision: 1e9,
                        departAt: 1e9, retreatSince: 0,
                    });
                    ship.components.set(TargetComponent, { target: GOAL });
                });
                const goal = new Position(0, 0);
                place(at(ship), h, new Position(-150, 100), goal,
                    'flying past at top speed');
                for (let i = 0; i < 30 * TICKS_PER_S; i++) {
                    world.step();
                }
                let near = Infinity;
                let far = 0;
                let fastest = 0;
                for (let i = 0; i < 10 * TICKS_PER_S; i++) {
                    world.step();
                    const d = distanceTo(at(ship), goal);
                    near = Math.min(near, d);
                    far = Math.max(far, d);
                    fastest = Math.max(fastest, speedOf(at(ship)));
                }
                const context = `held ${near.toFixed(0)}-${far.toFixed(0)} px `
                    + `at up to ${fastest.toFixed(0)} px/s`;
                expect(near).withContext(context)
                    .toBeGreaterThan(RETREAT_STANDOFF_MIN - 30);
                expect(far).withContext(context)
                    .toBeLessThan(RETREAT_STANDOFF_MAX + 30);
                expect(fastest).withContext(context)
                    .toBeLessThan(RETREAT_STANDOFF_HOLD_SPEED);
            });
    }

    it('a patrolling inertialess warship (a Dart) reaches its waypoint and '
        + 'keeps under way through it, at over half its top speed, rather '
        + 'than stopping on it', async () => {
            const h = HULLS[0];
            const { world, hull } = await mockWorld(h);
            const ship = await addHull(world, hull, SHIP, ship => {
                ship.components.set(NpcComponent, {
                    aiType: 3, mode: 'patrol', waypoint: [0, 0],
                    nextDecision: 1e9, departAt: 1e9,
                });
            });
            place(at(ship), h, new Position(1500, 0), new Position(0, 0),
                'at rest');
            let minDistance = Infinity;
            let slowestNear = Infinity;
            for (let i = 0; i < 10 * TICKS_PER_S; i++) {
                world.step();
                const d = distanceTo(at(ship), new Position(0, 0));
                minDistance = Math.min(minDistance, d);
                if (d < 200) {
                    slowestNear = Math.min(slowestNear, speedOf(at(ship)));
                }
            }
            expect(minDistance).toBeLessThan(100);
            // Still under way through the waypoint (a decision then picks
            // the next; it is frozen here).
            expect(slowestNear).toBeGreaterThan(0.5 * h.speed);
        });
});

describe('An inertialess escort', () => {
    const PLAYER = 'player';
    const PLANET = 'planet test:planet';

    async function escortWorld(h: Hull) {
        const { world, hull, gameData } = await mockWorld(h);
        const playerHull: ShipData = { ...getDefaultShipData(), id: 'test:player' };
        gameData.data.Ship.map.set(playerHull.id, playerHull);
        await gameData.data.Ship.get(playerHull.id);
        const player = makeShip(playerHull);
        player.components.set(ControlledByComponent, { peerId: 'peer' });
        await completeEntity(world, player);
        player.components.set(MovementStateComponent,
            still(new Position(0, 600)));
        world.entities.set(PLAYER, player);
        const escort = await addHull(world, hull, SHIP, ship => {
            ship.components.set(NpcComponent, { aiType: 3 });
            ship.components.set(TargetComponent, { target: undefined });
            ship.components.set(FormationComponent,
                { leader: PLAYER, slot: 0 });
            ship.components.set(EscortCommandComponent,
                { command: 'formation' });
            ship.components.set(FiringGroupComponent, { group: PLAYER });
            ship.components.set(PlayerEscortComponent, {
                player: PLAYER, parent: PLAYER, provenance: 'hired',
                deal: NO_DEAL,
            });
        });
        // Nothing to shoot with: the victim must live through the spec.
        escort.components.get(WeaponsStateComponent)?.clear();
        return { world, escort, player };
    }

    for (const h of HULLS) {
        it(`${h.name}: on an attack order closes to its standoff and holds `
            + 'there, guns on the victim, instead of orbiting it',
            async () => {
                const { world, escort } = await escortWorld(h);
                const goal = new Position(0, 0);
                place(at(escort), h, new Position(900, 400), goal,
                    'flying past at top speed');
                escort.components.set(EscortCommandComponent,
                    { command: 'attack', target: GOAL });
                for (let i = 0; i < 20 * TICKS_PER_S; i++) {
                    world.step();
                }
                let near = Infinity;
                let far = 0;
                let fastest = 0;
                for (let i = 0; i < 10 * TICKS_PER_S; i++) {
                    world.step();
                    const d = distanceTo(at(escort), goal);
                    near = Math.min(near, d);
                    far = Math.max(far, d);
                    fastest = Math.max(fastest, speedOf(at(escort)));
                }
                const context = `held ${near.toFixed(0)}-${far.toFixed(0)} px `
                    + `at up to ${fastest.toFixed(0)} px/s`;
                expect(near).withContext(context)
                    .toBeGreaterThan(0.8 * ESCORT_ATTACK_STANDOFF);
                expect(far).withContext(context)
                    .toBeLessThan(ESCORT_ATTACK_STANDOFF + 10);
                expect(fastest).withContext(context).toBeLessThan(1);
                const bearing = goal.subtract(at(escort).position).angle;
                expect(Math.abs(at(escort).rotation.distanceTo(bearing).angle))
                    .toBeLessThan(0.05);
            });

        it(`${h.name}: on an attack order keeps pace with a moving victim`,
            async () => {
                const { world, escort } = await escortWorld(h);
                const victim = world.entities.get(GOAL)!;
                // Cruising away at 40% of the escort's top speed (an
                // inertial body coasting: MovementSystem moves it).
                const cruise = new Vector(0.4 * h.speed, 0);
                at(victim).velocity = cruise;
                victim.components.set(MovementPhysicsComponent, {
                    acceleration: 0, maxVelocity: 1000, turnRate: 0,
                    movementType: MovementType.INERTIAL,
                });
                place(at(escort), h, new Position(-300, 500),
                    new Position(0, 0), 'flying past at top speed');
                escort.components.set(EscortCommandComponent,
                    { command: 'attack', target: GOAL });
                for (let i = 0; i < 20 * TICKS_PER_S; i++) {
                    world.step();
                }
                let near = Infinity;
                let far = 0;
                for (let i = 0; i < 10 * TICKS_PER_S; i++) {
                    world.step();
                    const d = Position.fromVectorLike(at(victim).position)
                        .subtract(at(escort).position).length;
                    near = Math.min(near, d);
                    far = Math.max(far, d);
                }
                const context = `held ${near.toFixed(0)}-${far.toFixed(0)} px`;
                expect(near).withContext(context)
                    .toBeGreaterThan(0.8 * ESCORT_ATTACK_STANDOFF);
                expect(far).withContext(context)
                    .toBeLessThan(ESCORT_ATTACK_STANDOFF + 60);
                expect(Vector.fromVectorLike(at(escort).velocity)
                    .subtract(cruise).length).toBeLessThan(5);
            });

        it(`${h.name}: on a hold order stops where it is`, async () => {
            const { world, escort } = await escortWorld(h);
            place(at(escort), h, new Position(300, 300), new Position(0, 0),
                'flying past at top speed');
            escort.components.set(EscortCommandComponent,
                { command: 'holdPosition' });
            for (let i = 0; i < 5 * TICKS_PER_S; i++) {
                world.step();
            }
            const held = Position.fromVectorLike(at(escort).position);
            expect(speedOf(at(escort))).toBeLessThan(0.5);
            for (let i = 0; i < 5 * TICKS_PER_S; i++) {
                world.step();
            }
            expect(held.subtract(at(escort).position).length)
                .toBeLessThan(1);
        });

        for (const start of STARTS) {
            it(`${h.name}, ${start}: follows the player down and lands within `
                + '30 s', async () => {
                    const { world, escort, player } = await escortWorld(h);
                    const planet = new Entity();
                    planet.components.set(PlanetComponent, { id: 'test:planet' });
                    planet.components.set(PlanetDataComponent, {
                        ...getDefaultPlanetData(), id: 'test:planet',
                    });
                    const stellar = new Position(2000, 0);
                    planet.components.set(MovementStateComponent,
                        still(stellar));
                    world.entities.set(PLANET, planet);
                    world.entities.delete(PLAYER);
                    void player;
                    place(at(escort), h, new Position(0, 0), stellar, start);
                    escort.components.set(EscortLandingComponent,
                        { planet: PLANET });
                    let landed = 0;
                    world.events.get(EscortLandedEvent).subscribe(() => {
                        landed++;
                    });
                    let ticks = 0;
                    let closest = Infinity;
                    for (; ticks < 30 * TICKS_PER_S
                        && world.entities.has(SHIP); ticks++) {
                        world.step();
                        closest = Math.min(closest,
                            distanceTo(at(escort), stellar));
                    }
                    expect(world.entities.has(SHIP)).withContext(
                        `still flying after ${ticks / TICKS_PER_S} s, `
                        + `${distanceTo(at(escort), stellar).toFixed(0)} px `
                        + `out at ${speedOf(at(escort)).toFixed(0)} px/s `
                        + `(closest ${closest.toFixed(0)}); the window is `
                        + `${Math.sqrt(ESCORT_LAND_DISTANCE_SQUARED)} px and `
                        + `${Math.sqrt(ESCORT_LAND_SPEED_SQUARED)} px/s`)
                        .toBeFalse();
                    expect(landed).toBe(1);
                });
        }
    }
});

/**
 * Bay fighters on the synthetic data (real hulls, so a docking is a real
 * collision with the carrier's hull): a Heron Warden's Skiffs, made
 * inertialess with the stock figures, ordered home.
 *
 * ReturnAI needed no inertialess path: it holds the nose ON the carrier
 * at full thrust, and an inertialess hull's velocity follows its nose, so
 * the range only ever closes (pure pursuit of a ship it outruns) and it
 * rams home, as an inertial fighter does. Even a Vell-os Dart (a 52 px
 * turning circle) crossing 45 px off the carrier's centre at top speed
 * comes round and docks. These pin that.
 */
describe('Inertialess bay fighters', () => {
    const WARDEN = SYNTHETIC.ships.warden;
    const SKIFF = SYNTHETIC.ships.skiff;
    const SKIFF_BAY = SYNTHETIC.weapons.skiffBay;

    for (const h of HULLS) {
        for (const carrierSpeed of [0, 0.3 * h.speed]) {
        it(`${h.name}: fly home and dock on returnToBay within 20 s (the `
            + `carrier ${carrierSpeed ? 'cruising' : 'at rest'})`,
            async () => {
                const gameData = await getSyntheticGameData();
                const world = await makeSystem(SYNTHETIC.systems.thessaly,
                    gameData, undefined, { npcs: false });
                const carrier = makeShip(await gameData.data.Ship.get(WARDEN));
                carrier.components.set(MultiplayerData, { owner: 'server' });
                carrier.components.set(TargetComponent, { target: undefined });
                await completeEntity(world, carrier);
                carrier.components.set(MovementStateComponent,
                    still(new Position(0, 0)));
                world.entities.set('carrier', carrier);
                world.step();
                // Launch both skiffs.
                const weapons = carrier.components.get(WeaponsStateComponent)!;
                const wings = () => [...world.entities].filter(([, e]) =>
                    e.components.has(BayFighterComponent));
                for (let i = 0; i < 10 * TICKS_PER_S && wings().length < 2;
                    i++) {
                    weapons.get(SKIFF_BAY)!.firing = true;
                    world.step();
                }
                weapons.get(SKIFF_BAY)!.firing = false;
                expect(wings().length).toBe(2);
                void SKIFF;
                // Make them inertialess hulls of the stock figures and send
                // them off: one far out at top speed across the line home,
                // one crossing close by at top speed, inside its own
                // turning circle of the carrier.
                const [[, a], [, b]] = wings();
                const starts: Array<[Entity, Position, Start]> = [
                    [a, new Position(700, -400), 'flying past at top speed'],
                    [b, new Position(45, 0), 'flying past at top speed'],
                ];
                for (const [wing, from, start] of starts) {
                    wing.components.set(ShipPhysicsComponent, {
                        ...wing.components.get(ShipPhysicsComponent)!,
                        speed: h.speed, acceleration: h.acceleration,
                        turnRate: h.turnRate, inertialess: true,
                    });
                    const bayFighter =
                        wing.components.get(BayFighterComponent)!;
                    delete bayFighter.launchBrake;
                    delete bayFighter.launchCoast;
                    place(at(wing), h, from, new Position(0, 0), start);
                }
                // The carrier coasts on (nothing steers it).
                at(carrier).velocity = new Vector(0, -carrierSpeed);
                world.step();
                for (const [wing] of starts) {
                    expect(wing.components.get(MovementPhysicsComponent)
                        ?.movementType).toBe(MovementType.INERTIALESS);
                }
                for (const [, wing] of wings()) {
                    wing.components.set(EscortCommandComponent,
                        { command: 'returnToBay' });
                }
                world.step();
                for (const [, wing] of wings()) {
                    expect(wing.components.has(ReturnComponent)).toBeTrue();
                }
                let ticks = 0;
                for (; ticks < 20 * TICKS_PER_S && wings().length > 0;
                    ticks++) {
                    world.step();
                }
                const home = Position.fromVectorLike(at(carrier).position);
                expect(wings().map(([, wing]) => {
                    const m = at(wing);
                    return `${distanceTo(m, home).toFixed(0)} px `
                        + `out at ${speedOf(m).toFixed(0)} px/s`;
                })).withContext(`after ${ticks / TICKS_PER_S} s`).toEqual([]);
            });
        }
    }
});

/**
 * The same on the base data itself (pending without Nova_Data): the stock
 * hulls, as parsed, in the sorted-first stock system, an NPC trader parking
 * at a real stellar and a hired escort holding its standoff on attack.
 */
describe('Stock inertialess hulls (base data)', () => {
    const STOCK = ['nova:173', 'nova:175', 'nova:164', 'nova:176', 'nova:170'];

    async function stockWorld() {
        const gameData = await getIntegrationGameData();
        const ids = await gameData.ids;
        const systemId = [...ids.System].sort()[0]!;
        const world = await makeSystem(systemId, gameData, undefined,
            { npcs: false });
        const [planetUuid] = [...world.entities]
            .find(([, entity]) => entity.components.has(PlanetComponent))!;
        return { gameData, world, planetUuid };
    }

    for (const id of STOCK) {
        it(`${id}: an NPC trader parks at a stellar and sits still`,
            async () => {
                const { gameData, world, planetUuid } = await stockWorld();
                const data = await gameData.data.Ship.get(id);
                expect(data.physics.inertialess).toBeTrue();
                const ship = makeShip(data);
                ship.components.set(NpcComponent, {
                    aiType: 1, mode: 'travel', destination: planetUuid,
                    nextDecision: 1e9, departAt: 1e9,
                });
                await completeEntity(world, ship);
                world.entities.set(SHIP, ship);
                world.step();
                const planet = Position.fromVectorLike(at(world.entities
                    .get(planetUuid)!).position);
                const h: Hull = { name: id, ...data.physics };
                place(at(ship), h, planet.add(new Vector(700, -300)), planet,
                    'flying past at top speed');
                const npc = ship.components.get(NpcComponent)!;
                npc.mode = 'travel';
                let ticks = 0;
                while (npc.mode === 'travel' && ticks < 30 * TICKS_PER_S) {
                    world.step();
                    ticks++;
                }
                expect(npc.mode).toBe('dwell');
                for (let i = 0; i < 3 * TICKS_PER_S; i++) {
                    world.step();
                }
                expect(speedOf(at(ship))).toBeLessThan(1);
                expect(distanceTo(at(ship), planet)).toBeLessThan(150);
            });

        it(`${id}: a hired escort on attack holds its standoff`, async () => {
            const { gameData, world } = await stockWorld();
            const data = await gameData.data.Ship.get(id);
            const victim = new Entity();
            victim.components.set(MovementStateComponent,
                still(new Position(0, 0)));
            world.entities.set(GOAL, victim);
            const escort = makeShip(data);
            escort.components.set(NpcComponent, { aiType: 3 });
            escort.components.set(TargetComponent, { target: undefined });
            escort.components.set(EscortCommandComponent,
                { command: 'attack', target: GOAL });
            await completeEntity(world, escort);
            world.entities.set(SHIP, escort);
            world.step();
            escort.components.get(WeaponsStateComponent)?.clear();
            const h: Hull = { name: id, ...data.physics };
            place(at(escort), h, new Position(900, 400), new Position(0, 0),
                'flying past at top speed');
            for (let i = 0; i < 20 * TICKS_PER_S; i++) {
                world.step();
            }
            const d = distanceTo(at(escort), new Position(0, 0));
            expect(d).toBeGreaterThan(0.8 * ESCORT_ATTACK_STANDOFF);
            expect(d).toBeLessThan(ESCORT_ATTACK_STANDOFF + 10);
            expect(speedOf(at(escort))).toBeLessThan(1);
        });
    }
});
