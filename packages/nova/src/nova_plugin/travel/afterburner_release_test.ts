import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultShipData, getDefaultShipPhysics, ShipData } from 'novadatainterface/ship_data';
import { Entity } from 'nova_ecs/entity';
import { MovementPhysicsComponent, MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import {
    AFTERBURNER_FACTOR, AFTERBURNER_THRUST, decayedSpeedCap,
    OVERSPEED_DECAY_FACTOR,
} from './afterburner_plugin.js';
import {
    ShipAccelerationConversionFactor, ShipSpeedConversionFactor,
} from 'novaparse/parsers/constants';
import { completeEntity } from '../spawn/index.js';
import { makeShip } from '../ship/index.js';
import { makeSystem, SIMULATION_STEP_MS } from '../make_system.js';
import { ShipControlStateComponent } from '../player/index.js';
import { IonizationComponent, IsIonizedComponent } from '../ship/index.js';

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

    it('boosts every hull a flat 1.8 x and coasts down at 0.7 of the '
        + 'hull\'s acceleration (reference "The afterburner with a ruler '
        + '(U4), wave 43")', () => {
            expect(AFTERBURNER_FACTOR).toBe(1.8);
            expect(OVERSPEED_DECAY_FACTOR).toBe(0.7);
            expect(AFTERBURNER_THRUST).toBe(250);
        });

    it('comes up to the boosted speed on the burner\'s own thrust, in '
        + 'about half a second on Kit Probe A (reference "The afterburner '
        + 'with a ruler (U4), wave 43": 131 -> 237 px/s in 0.4-0.5 s, '
        + 'about 250 px/s², not 1.8 x its 54 px/s²)', async () => {
            // Kit Probe A: Speed 300, Accel 300.
            const probeSpeed = 300 * ShipSpeedConversionFactor;
            const probeAccel = 300 * ShipAccelerationConversionFactor;
            const { world, ship } = await makeAfterburnerWorld(0, {
                speed: probeSpeed, acceleration: probeAccel,
            });
            const controls = ship.components.get(ShipControlStateComponent)!;
            // Cruise first (2.5 s from rest at 54 px/s²).
            controls.set('accelerate', true);
            await stepWorld(world, 200);
            expect(speed(ship)).toBeCloseTo(probeSpeed, 6);
            controls.set('afterburner', true);
            expect(ship.components.get(MovementPhysicsComponent)!.acceleration)
                .toBe(probeAccel);
            await stepWorld(world, 1);
            expect(ship.components.get(MovementPhysicsComponent)!.acceleration)
                .toBe(AFTERBURNER_THRUST);
            // 0.8 x 135 = 108 px/s at 250 px/s²: 0.43 s, 26 ticks.
            await stepWorld(world, 24);
            expect(speed(ship)).toBeLessThan(probeSpeed * AFTERBURNER_FACTOR);
            await stepWorld(world, 3);
            expect(speed(ship))
                .toBeCloseTo(probeSpeed * AFTERBURNER_FACTOR, 6);

            // The coast back down with Up held: 0.7 x 54 = 37.8 px/s²
            // (measured 44 on Probe A), 108 px/s in about 2.9 s.
            controls.set('afterburner', false);
            await stepWorld(world, 60);
            expect(speed(ship)).toBeCloseTo(
                probeSpeed * AFTERBURNER_FACTOR - 0.7 * probeAccel, 3);
            await stepWorld(world, 120);
            expect(speed(ship)).toBeCloseTo(probeSpeed, 6);
        });

    it('keeps a hull\'s own acceleration when it beats the burner\'s '
        + 'thrust', async () => {
            const { world, ship } = await makeAfterburnerWorld(0, {
                acceleration: 400,
            });
            ship.components.get(ShipControlStateComponent)!
                .set('afterburner', true);
            await stepWorld(world, 1);
            expect(ship.components.get(MovementPhysicsComponent)!.acceleration)
                .toBe(400);
        });

    async function makeAfterburnerWorld(ionization = 0,
        physics: Partial<ShipData['physics']> = {}) {
        const gameData = new MockGameData();
        const shipData: ShipData = {
            ...getDefaultShipData(),
            id: SHIP_ID,
            physics: {
                ...getDefaultShipPhysics(),
                energy: 10000,
                // Plenty of fuel to hold the burn as long as we like.
                afterburner: 1,
                ionization,
                ...physics,
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
        // The default hull's own 300 beats the burner's 250, so 540
        // units of speed take 1.8 s; 120 steps is two seconds.
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
        // The whole coast-down is 0.8 of BASE_SPEED of overspeed at 0.7
        // of ACCELERATION per second: about 1.14 s, i.e. 68 steps.
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
        // Long past the ~1.14 seconds the coast-down needs.
        await stepWorld(world, 180);
        expect(speed(ship)).toBeCloseTo(BASE_SPEED, 6);
        expect(ship.components.get(MovementPhysicsComponent)!.maxVelocity)
            .toEqual(BASE_SPEED);
    });

    it('still burns on a fully ionized hull (reference "Ionization\'s cap '
        + 'and the afterburner (E6 leftovers), wave 40")', async () => {
            const { world, ship } = await makeAfterburnerWorld(100);
            // Far past IonizeMax: the charge is not capped.
            ship.components.get(IonizationComponent)!.current = 5000;
            await stepWorld(world, 2);
            expect(ship.components.get(IsIonizedComponent)).toBeTrue();
            ship.components.get(ShipControlStateComponent)!
                .set('afterburner', true);
            await stepWorld(world, 600);
            expect(ship.components.get(IsIonizedComponent)).toBeTrue();
            expect(ship.components.get(MovementPhysicsComponent)!.maxVelocity)
                .toEqual(BASE_SPEED * AFTERBURNER_FACTOR);
            expect(speed(ship)).toBeGreaterThan(BASE_SPEED);
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
