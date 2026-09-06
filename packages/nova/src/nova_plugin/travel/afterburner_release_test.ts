import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultShipData, getDefaultShipPhysics, ShipData } from 'novadatainterface/ship_data';
import { Entity } from 'nova_ecs/entity';
import { MovementPhysicsComponent, MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import {
    AFTERBURNER_FACTOR, decayedSpeedCap, OVERSPEED_DECAY_FACTOR,
} from './afterburner_plugin.js';
import { completeEntity } from '../spawn/entity_data_loader.js';
import { makeShip } from '../ship/make_ship.js';
import { makeSystem, SIMULATION_STEP_MS } from '../make_system.js';
import { ShipControlStateComponent } from '../player/ship_control.js';

const SHIP_ID = 'test:ship';
const BASE_SPEED = getDefaultShipPhysics().speed;
const ACCELERATION = getDefaultShipPhysics().acceleration;
const DELTA_S = SIMULATION_STEP_MS / 1000;
/** How much speed one tick of the coast-down sheds. */
const DECAY_PER_STEP = ACCELERATION * OVERSPEED_DECAY_FACTOR * DELTA_S;

/**
 * Releasing the afterburner used to halve a ship's speed inside a single
 * tick: the cap dropped straight back to normal and MovementSystem
 * truncates velocity to the cap. Matthew's playtest note — "the return to
 * normal speed when turning off the afterburner is too aggressive". The
 * ship should coast back down instead.
 */
describe('afterburner release', () => {
    describe('decayedSpeedCap', () => {
        it('caps a ship the cap already covers', () => {
            expect(decayedSpeedCap(300, 250, 300, 1 / 60)).toBe(300);
            expect(decayedSpeedCap(300, 300, 300, 1 / 60)).toBe(300);
        });

        it('bleeds overspeed off at the decay rate', () => {
            expect(decayedSpeedCap(300, 600, 300, 0.1)).toBe(570);
            expect(decayedSpeedCap(300, 570, 300, 0.1)).toBe(540);
        });

        it('never dips below the real cap', () => {
            expect(decayedSpeedCap(300, 310, 300, 1)).toBe(300);
        });

        it('is a no-op when nothing is over the cap', () => {
            expect(decayedSpeedCap(300, 0, 300, 1 / 60)).toBe(300);
        });
    });

    async function makeAfterburnerWorld() {
        const gameData = new MockGameData();
        const shipData: ShipData = {
            ...getDefaultShipData(),
            id: SHIP_ID,
            physics: {
                ...getDefaultShipPhysics(),
                energy: 10000,
                // Plenty of fuel to hold the burn as long as we like.
                afterburner: 1,
            },
        };
        gameData.data.Ship.map.set(SHIP_ID, shipData);

        const world = await makeSystem('test:system', gameData);
        const ship = makeShip(shipData);
        await completeEntity(world, ship);
        world.entities.set('test ship uuid', ship);
        ship.components.set(ShipControlStateComponent, new Map());
        await stepWorld(world, 2);
        return { world, ship };
    }

    async function stepWorld(world: World, steps: number) {
        for (let i = 0; i < steps; i++) {
            world.step();
            await new Promise(resolve => setImmediate(resolve));
        }
    }

    /** Holds the burner until the ship saturates at its boosted top speed. */
    async function burnToTopSpeed() {
        const { world, ship } = await makeAfterburnerWorld();
        ship.components.get(ShipControlStateComponent)!
            .set('afterburner', true);
        // Boosted acceleration is 2x300, so 600 units of speed takes well
        // under a second; 120 steps is two seconds of margin.
        await stepWorld(world, 120);
        return { world, ship };
    }

    function speed(ship: Entity) {
        return ship.components.get(MovementStateComponent)!.velocity.length;
    }

    it('holds the ship at the boosted cap while engaged', async () => {
        const { ship } = await burnToTopSpeed();
        expect(speed(ship)).toBeCloseTo(BASE_SPEED * AFTERBURNER_FACTOR, 6);
        expect(ship.components.get(MovementPhysicsComponent)!.maxVelocity)
            .toEqual(BASE_SPEED * AFTERBURNER_FACTOR);
    });

    it('coasts down instead of snapping when released', async () => {
        const { world, ship } = await burnToTopSpeed();
        ship.components.get(ShipControlStateComponent)!
            .set('afterburner', false);

        // One tick after release the ship has lost one tick's worth of
        // speed, not half its speed.
        await stepWorld(world, 1);
        expect(speed(ship))
            .toBeCloseTo(BASE_SPEED * AFTERBURNER_FACTOR - DECAY_PER_STEP, 6);
    });

    it('decreases smoothly and monotonically across ticks', async () => {
        const { world, ship } = await burnToTopSpeed();
        ship.components.get(ShipControlStateComponent)!
            .set('afterburner', false);

        let previous = speed(ship);
        const drops: number[] = [];
        // The whole coast-down is BASE_SPEED of overspeed at
        // ACCELERATION per second — one second, i.e. 60 steps.
        for (let i = 0; i < 55; i++) {
            await stepWorld(world, 1);
            const current = speed(ship);
            expect(current).withContext(`step ${i} is slower`)
                .toBeLessThan(previous);
            expect(current).withContext(`step ${i} stays above top speed`)
                .toBeGreaterThan(BASE_SPEED);
            drops.push(previous - current);
            previous = current;
        }
        // Every tick sheds the same amount: a straight line, not a step.
        for (const drop of drops) {
            expect(drop).toBeCloseTo(DECAY_PER_STEP, 6);
        }
    });

    it('settles at exactly the ship\'s top speed', async () => {
        const { world, ship } = await burnToTopSpeed();
        ship.components.get(ShipControlStateComponent)!
            .set('afterburner', false);
        // Long past the ~1 second the coast-down needs.
        await stepWorld(world, 180);
        expect(speed(ship)).toBeCloseTo(BASE_SPEED, 6);
        expect(ship.components.get(MovementPhysicsComponent)!.maxVelocity)
            .toEqual(BASE_SPEED);
    });

    it('re-engages from the coast-down without losing the boost', async () => {
        const { world, ship } = await burnToTopSpeed();
        const controls = ship.components.get(ShipControlStateComponent)!;
        controls.set('afterburner', false);
        await stepWorld(world, 10);
        const partway = speed(ship);
        expect(partway).toBeLessThan(BASE_SPEED * AFTERBURNER_FACTOR);

        controls.set('afterburner', true);
        await stepWorld(world, 120);
        expect(speed(ship)).toBeCloseTo(BASE_SPEED * AFTERBURNER_FACTOR, 6);
    });
});
