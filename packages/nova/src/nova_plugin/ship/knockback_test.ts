import 'jasmine';
import { DEFAULT_IONIZE_COLOR, WeaponDamage } from 'novadatainterface/weapon_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import {
    MovementPhysicsComponent, MovementStateComponent, MovementType,
} from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { getSyntheticGameData } from '../../communication/simulation_test_fixture.js';
import { makeSystem } from '../make_system.js';
import { completeEntity } from '../spawn/index.js';
import {
    DamagedEvent, DisabledComponent, DISABLED_COAST_TIME_CONSTANT_S,
    DISABLED_REST_SPEED, knockedVelocity, makeShip, ShipDataComponent,
    ShipPhysicsComponent,
} from './index.js';

describe('knockedVelocity', () => {
    it('adds an impulse in full below the top speed', () => {
        const v = knockedVelocity(new Vector(10, 0), new Vector(0, 20), 90);
        expect(v.x).toBe(10);
        expect(v.y).toBe(20);
    });

    it('never pushes a ship past its top speed', () => {
        const v = knockedVelocity(new Vector(80, 0), new Vector(500, 0), 90);
        expect(v.length).toBeCloseTo(90, 9);
        expect(v.y).toBe(0);
    });

    it('can turn a ship at its cap without speeding it up', () => {
        const v = knockedVelocity(new Vector(90, 0), new Vector(0, 90), 90);
        expect(v.length).toBeCloseTo(90, 9);
        // Turned 45 degrees toward the push.
        expect(v.x).toBeCloseTo(v.y, 9);
    });

    it('never adds to a speed already above the cap (an afterburner '
        + 'overspeed bleeds at its own rate), but can slow it', () => {
        const faster = knockedVelocity(new Vector(200, 0),
            new Vector(50, 0), 90);
        expect(faster.length).toBeCloseTo(200, 9);
        const slower = knockedVelocity(new Vector(200, 0),
            new Vector(-50, 0), 90);
        expect(slower.x).toBe(150);
    });
});

/**
 * A light hull (a Hyperioid's numbers: 10 t, 90 px/s, 45 px/s²) taking
 * a heavy beam's worth of knockback every step, as a Thunderhead Lance
 * (impact 50, 10 units a shot) lands it, from a fixed shooter.
 */
describe('knockback on a light hull under sustained fire', () => {
    const TARGET = 'target';
    const SHOOTER = 'shooter';
    const TOP_SPEED = 90;
    const HEAVY: WeaponDamage = {
        shield: 0, armor: 0, ionization: 0,
        ionizationColor: DEFAULT_IONIZE_COLOR, passThroughShield: 0,
        knockback: 50, disableOnly: false,
    };

    async function lightHullWorld(inertialess: boolean) {
        const gameData = await getSyntheticGameData();
        const world = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
            'worker', { npcs: false });
        const shipData = (await gameData.data.Ship.get(
            SYNTHETIC.ships.skiff))!;
        const ship = makeShip(shipData);
        await completeEntity(world, ship);
        ship.components.set(ShipDataComponent, {
            ...ship.components.get(ShipDataComponent)!,
            physics: {
                ...shipData.physics, mass: 10, speed: TOP_SPEED,
                acceleration: 45, inertialess,
            },
        });
        // Re-derived from the ShipData above on the next step.
        ship.components.delete(ShipPhysicsComponent);
        world.entities.set(TARGET, ship);
        const shooter = new Entity(SHOOTER);
        // Fires along +y (the clock-angle unit vector of 0 is (0, -1);
        // the direction does not matter, only that it is fixed).
        shooter.components.set(MovementStateComponent, {
            position: new Position(0, -400), velocity: new Vector(0, 0),
            rotation: new Angle(Math.PI), turning: 0, turnBack: false,
            accelerating: 0,
        });
        world.entities.set(SHOOTER, shooter);
        const movement = ship.components.get(MovementStateComponent)!;
        movement.position = new Position(0, 0);
        // Flying across the line of fire.
        movement.rotation = new Angle(Math.PI / 2);
        world.step();
        expect(ship.components.get(MovementPhysicsComponent)!)
            .toEqual(jasmine.objectContaining({
                maxVelocity: TOP_SPEED,
                movementType: inertialess
                    ? MovementType.INERTIALESS : MovementType.INERTIAL,
            }));
        return { world, ship, movement };
    }

    function hammer(world: World, steps: number, onStep: () => void) {
        for (let i = 0; i < steps; i++) {
            world.emit(DamagedEvent, { damage: HEAVY, damager: SHOOTER },
                [TARGET]);
            world.step();
            onStep();
        }
    }

    for (const inertialess of [true, false]) {
        const kind = inertialess ? 'an inertialess' : 'an inertial';
        it(`holds ${kind} hull, thrusting, at its top speed (was over `
            + '5,000 px/s in 10 s)', async () => {
            const { world, movement } = await lightHullWorld(inertialess);
            let maxSpeed = 0;
            let maxTargetSpeed = 0;
            hammer(world, 600, () => {
                movement.accelerating = 1;
                maxSpeed = Math.max(maxSpeed, movement.velocity.length);
                maxTargetSpeed = Math.max(maxTargetSpeed,
                    movement.targetSpeed ?? 0);
            });
            expect(maxSpeed).toBeLessThanOrEqual(TOP_SPEED + 1e-9);
            // The pushes did land: it is at its cap.
            expect(maxSpeed).toBeGreaterThan(TOP_SPEED * 0.9);
            // The inertialess model's targetSpeed never ratchets up
            // with an overspeed (it used to follow the raised cap).
            expect(maxTargetSpeed).toBeLessThanOrEqual(TOP_SPEED);
        }, 60_000);

        it(`keeps ${kind} hulk under fire within its top speed, and `
            + 'lets it coast to rest once the fire stops', async () => {
            const { world, ship, movement } =
                await lightHullWorld(inertialess);
            // Up to speed first, then disabled for good (a hulk: the
            // armor stays above the threshold).
            for (let i = 0; i < 180; i++) {
                movement.accelerating = 1;
                world.step();
            }
            ship.components.set(DisabledComponent,
                { repairAt: null, hulk: true });
            let maxSpeed = 0;
            hammer(world, 600, () => {
                maxSpeed = Math.max(maxSpeed, movement.velocity.length);
            });
            expect(maxSpeed).toBeLessThanOrEqual(TOP_SPEED + 1e-9);
            // The fire stops: the measured coast, from at most the top
            // speed, rests by tau x ln(top / DISABLED_REST_SPEED).
            const restSteps = Math.ceil(DISABLED_COAST_TIME_CONSTANT_S
                * Math.log(TOP_SPEED / DISABLED_REST_SPEED) * 60) + 10;
            for (let i = 0; i < restSteps; i++) {
                world.step();
            }
            expect(movement.velocity.length).toBe(0);
            expect(ship.components.has(DisabledComponent)).toBeTrue();
        }, 60_000);
    }

    it('coasts an inertialess hulk on the measured exponential, along its '
        + 'own line (it used to cruise on at its targetSpeed forever)',
        async () => {
            const { world, ship, movement } = await lightHullWorld(true);
            for (let i = 0; i < 180; i++) {
                movement.accelerating = 1;
                world.step();
            }
            const v0 = movement.velocity.length;
            expect(v0).toBeCloseTo(TOP_SPEED, 6);
            const heading = movement.velocity.normalize();
            ship.components.set(DisabledComponent,
                { repairAt: null, hulk: true });
            // One time constant later: 1/e of the speed, same direction.
            const tauSteps = Math.round(DISABLED_COAST_TIME_CONSTANT_S * 60);
            for (let i = 0; i < tauSteps; i++) {
                world.step();
            }
            const v = movement.velocity.length;
            expect(v).toBeCloseTo(v0 / Math.E, 0);
            const direction = movement.velocity.normalize();
            expect(direction.x).toBeCloseTo(heading.x, 6);
            expect(direction.y).toBeCloseTo(heading.y, 6);
            expect(movement.targetSpeed).toBeCloseTo(v, 9);
        }, 60_000);
});
