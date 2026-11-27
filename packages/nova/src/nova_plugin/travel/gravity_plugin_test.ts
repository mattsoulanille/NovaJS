import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultPlanetData } from 'novadatainterface/planet_data';
import {
    getDefaultShipData, getDefaultShipPhysics, ShipPhysics,
} from 'novadatainterface/ship_data';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import { makeSystem, SIMULATION_STEP_MS } from '../make_system.js';
import { makeShip } from '../ship/index.js';
import { completeEntity } from '../spawn/index.js';
import { gravityAcceleration, gravityDeltaV } from './gravity_plugin.js';
import { JumpComponent } from './jump_state.js';
import { makePlanet } from './make_planet.js';

/**
 * spöb Gravity (reference "spöb Gravity (U7), wave 40"). No stock stellar
 * has Gravity, so these wells are made up here.
 */

const SHIP_ID = 'test:ship';
const SHIP = 'ship under test';
const WELL_ID = 'test:well';
const BASE = getDefaultShipPhysics();
const STEPS_PER_S = 1000 / SIMULATION_STEP_MS;

async function gravityWorld(gravity: number, startX: number,
    physics: Partial<ShipPhysics> = {}) {
    const gameData = new MockGameData();
    gameData.data.Ship.map.set(SHIP_ID, {
        ...getDefaultShipData(), id: SHIP_ID,
        physics: { ...BASE, ...physics },
    });
    gameData.data.Planet.map.set(WELL_ID, {
        ...getDefaultPlanetData(), id: WELL_ID, name: 'Well',
        position: [0, 0], gravity,
    });
    const world = await makeSystem('test:system', gameData);
    const well = makePlanet(gameData.data.Planet.map.get(WELL_ID)!);
    await completeEntity(world, well);
    world.entities.set('well', well);
    const ship = makeShip(gameData.data.Ship.map.get(SHIP_ID)!);
    await completeEntity(world, ship);
    world.entities.set(SHIP, ship);
    const movement = ship.components.get(MovementStateComponent)!;
    movement.position = new Position(startX, 0);
    movement.velocity = new Vector(0, 0);
    return { world, ship };
}

function steps(world: World, n: number) {
    for (let i = 0; i < n; i++) {
        world.step();
    }
}

function state(ship: Entity) {
    return ship.components.get(MovementStateComponent)!;
}

describe('gravityDeltaV', () => {
    it('pulls toward a positive well and pushes from a negative one', () => {
        const pull = gravityDeltaV([{ dx: -300, dy: 0, gravity: 1 }], 1);
        expect(pull.x).toBeCloseTo(-gravityAcceleration(1), 9);
        expect(pull.y).toBeCloseTo(0, 9);
        const push = gravityDeltaV([{ dx: -300, dy: 0, gravity: -2 }], 1);
        expect(push.x).toBeCloseTo(gravityAcceleration(2), 9);
        expect(gravityAcceleration(-2)).toBe(-gravityAcceleration(2));
    });

    it('does not fall off with distance', () => {
        const near = gravityDeltaV([{ dx: 0, dy: 300, gravity: 10 }], 0.5);
        const far = gravityDeltaV([{ dx: 0, dy: 2000, gravity: 10 }], 0.5);
        expect(near.length).toBeCloseTo(far.length, 9);
    });

    it('gives nothing from a well the ship sits exactly on, or Gravity 0',
        () => {
            expect(gravityDeltaV([{ dx: 0, dy: 0, gravity: 100 }], 1).length)
                .toBe(0);
            expect(gravityDeltaV([{ dx: 50, dy: 0, gravity: 0 }], 1).length)
                .toBe(0);
        });

    it('is about 1 px a frame per second at Gravity 1', () => {
        // 30 fps frames: 30 px/s² is 1 px a frame per s (wave 40).
        expect(gravityAcceleration(1) / 30).toBeCloseTo(1, 0);
    });

    it('pulls about 39 / 55 px/s² a unit at Gravity 5 / 10 (reference '
        + '"Gravity damping and strength (U7, ...), wave 41")', () => {
        expect(gravityAcceleration(5) / 5).toBeCloseTo(39, 9);
        expect(gravityAcceleration(10) / 10).toBeCloseTo(55, 9);
    });
});

describe('GravitySystem', () => {
    it('ramps a ship toward a Gravity-1 well at about 1 px a frame per '
        + 'second', async () => {
            const { world, ship } = await gravityWorld(1, 300);
            steps(world, STEPS_PER_S);
            const velocity = state(ship).velocity;
            expect(velocity.x).toBeCloseTo(-gravityAcceleration(1), 3);
            expect(velocity.y).toBeCloseTo(0, 9);
            expect(state(ship).position.x).toBeLessThan(300);
        });

    it('caps the pull at the ship\'s own top speed', async () => {
        const { world, ship } = await gravityWorld(1000, 2000);
        steps(world, 10);
        expect(state(ship).velocity.length).toBeCloseTo(BASE.speed, 6);
        const slow = await gravityWorld(1000, 2000, { speed: BASE.speed / 2 });
        steps(slow.world, 10);
        expect(state(slow.ship).velocity.length)
            .toBeCloseTo(BASE.speed / 2, 6);
    });

    it('holds a ship on a Gravity-100 well once it gets there',
        async () => {
            // Kit Probe A: Speed 300, 135 px/s (about 4.5 px a frame).
            const { world, ship } = await gravityWorld(100, 300,
                { speed: 135 });
            // 300 px at about top speed: a little over two seconds.
            steps(world, 3 * STEPS_PER_S);
            for (let i = 0; i < 2 * STEPS_PER_S; i++) {
                world.step();
                const { x, y } = state(ship).position;
                // The original's "few-pixel jitter".
                expect(Math.hypot(x, y)).withContext(`step ${i}`)
                    .toBeLessThan(5);
            }
        });

    it('swings a ship through a weak well with no damping: its peak speed '
        + 'holds (reference "Gravity damping and strength (U7, ...), wave '
        + '41": 5-6 px a frame for 75 s at Gravity 5 and 10)', async () => {
            for (const gravity of [5, 10]) {
                const { world, ship } = await gravityWorld(gravity, 300,
                    { speed: 135 });
                // The peak speed in every 2 s window of 40 s, and the
                // ship never stops on the well.
                for (let window = 0; window < 20; window++) {
                    let peak = 0;
                    for (let i = 0; i < 2 * STEPS_PER_S; i++) {
                        world.step();
                        peak = Math.max(peak, state(ship).velocity.length);
                    }
                    expect(peak).withContext(`G${gravity} window ${window}`)
                        .toBeGreaterThan(0.95 * 135);
                }
            }
        });

    it('lets a weak well swing the ship through and back', async () => {
        const { world, ship } = await gravityWorld(10, 300);
        let crossed = false;
        let turnedBack = false;
        for (let i = 0; i < 6 * STEPS_PER_S; i++) {
            world.step();
            const { position, velocity } = state(ship);
            crossed ||= position.x < 0;
            turnedBack ||= crossed && velocity.x > 0;
        }
        expect(crossed).toBeTrue();
        expect(turnedBack).toBeTrue();
    });

    it('pushes a ship away from a negative well at its top speed',
        async () => {
            const { world, ship } = await gravityWorld(-1000, 300);
            steps(world, 2 * STEPS_PER_S);
            const { position, velocity } = state(ship);
            expect(velocity.x).toBeCloseTo(BASE.speed, 6);
            expect(position.x).toBeGreaterThan(300 + BASE.speed);
        });

    it('does not move an inertialess ship', async () => {
        const { world, ship } = await gravityWorld(1000, 300,
            { inertialess: true });
        steps(world, STEPS_PER_S);
        expect(state(ship).velocity.length).toBe(0);
        expect(state(ship).position.x).toBeCloseTo(300, 9);
    });

    it('does not move a hull that ignores gravity (shïp Flags3 0x0010, '
        + 'oütf ModType 41)', async () => {
            const { world, ship } = await gravityWorld(1000, 300,
                { ignoresGravity: true });
            steps(world, STEPS_PER_S);
            expect(state(ship).velocity.length).toBe(0);
        });

    it('leaves a ship in a jump sequence alone', async () => {
        const { world, ship } = await gravityWorld(1000, 300);
        ship.components.set(JumpComponent,
            { stage: 'spinup', direction: 0, to: 'test:elsewhere' });
        world.step();
        expect(state(ship).velocity.length).toBe(0);
    });
});
