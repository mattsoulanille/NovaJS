import 'jasmine';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import {
    MovementPhysicsComponent, MovementStateComponent, MovementType,
} from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import {
    getSyntheticGameData, makeSimulationBridgeHarness,
} from '../../communication/simulation_test_fixture.js';
import { SimulationBridgeClient } from '../../communication/simulation_bridge_client.js';
import { ControlAction } from '../core/index.js';
import { ControlledByComponent } from '../player/index.js';
import { makeShip, ShipDataComponent } from '../ship/index.js';
import { completeEntity } from '../spawn/index.js';

/**
 * Reverse (ArrowDown) and point-to (KeyA), driven through the REAL input
 * path a browser key takes once key_actions.ts has resolved it: the
 * bridge client's controlEvents -> the host's input record -> the
 * rollback step's applyControlEvents -> ShipControlStateComponent ->
 * ControlShipSystem -> MovementSystem.
 *
 * The rule, after the original:
 *   - an INERTIAL hull's reverse turns it to face against its velocity
 *     (retro-heading). It does not brake by itself: the player thrusts
 *     once it faces backwards.
 *   - an INERTIALESS hull's reverse brakes it (reference "U9 and the
 *     inertialess hulls", wave 3: "Down does brake an inertialess hull to
 *     a stop").
 *   - point-to turns the ship to face its target ship (or, with none,
 *     its selected stellar).
 */
describe('reverse and point-to through the bridge input path', () => {
    const TICKS_PER_SECOND = 60;

    async function makeHarness(inertialess: boolean) {
        const harness = await makeSimulationBridgeHarness(
            getSyntheticGameData());
        const { world, shipUuid } = harness;
        const ship = world.entities.get(shipUuid)!;
        // The harness world's communicator is "server": the host applies
        // that peer's inputs to the ship it controls, as in a room.
        ship.components.set(ControlledByComponent, { peerId: 'server' });
        if (inertialess) {
            const data = ship.components.get(ShipDataComponent)!;
            ship.components.set(ShipDataComponent, {
                ...data,
                physics: { ...data.physics, inertialess: true },
            });
        }
        harness.client.step(5);
        expect(ship.components.get(MovementPhysicsComponent)?.movementType)
            .withContext('the hull type under test')
            .toBe(inertialess ? MovementType.INERTIALESS
                : MovementType.INERTIAL);
        return { ...harness, ship };
    }

    function movement(ship: Entity) {
        return ship.components.get(MovementStateComponent)!;
    }

    function hold(client: SimulationBridgeClient, action: ControlAction,
        seconds: number) {
        client.controlEvents([{ action, state: 'start' }]);
        for (let i = 0; i < seconds * TICKS_PER_SECOND; i++) {
            client.step();
        }
    }

    function release(client: SimulationBridgeClient, action: ControlAction) {
        client.controlEvents([{ action, state: false }]);
        client.step();
    }

    /** Thrusts along the ship's heading for `seconds`. */
    function thrust(client: SimulationBridgeClient, seconds: number) {
        hold(client, 'accelerate', seconds);
        release(client, 'accelerate');
    }

    /** |a - b| as an angle in [0, pi]. */
    function angleBetween(a: Angle, b: Angle) {
        return Math.abs(a.distanceTo(b).angle);
    }

    it('brakes an inertialess hull to a stop', async () => {
        const { client, ship } = await makeHarness(true);
        thrust(client, 4);
        const cruising = movement(ship).velocity.length;
        expect(cruising).toBeGreaterThan(20);
        // It keeps its speed with nothing held (wave 3).
        client.step(30);
        expect(movement(ship).velocity.length).toBeCloseTo(cruising, 3);

        hold(client, 'reverse', 4);
        expect(movement(ship).velocity.length).toBeLessThan(1);
        release(client, 'reverse');
        client.step(60);
        expect(movement(ship).velocity.length)
            .withContext('stays stopped once reverse is let go')
            .toBeLessThan(1);
    });

    it('holds an inertialess hull\'s speed while thrust is ALSO held (the '
        + 'two keys add), and brakes it once thrust is let go', async () => {
        // The headless report this file answers ("ArrowDown never braked a
        // Raven: it stayed at 99.4 px/s") reads like this case: a thrust
        // key whose release never reached the game.
        const { client, ship } = await makeHarness(true);
        client.controlEvents([{ action: 'accelerate', state: 'start' }]);
        client.step(60);
        const speed = movement(ship).velocity.length;
        expect(speed).toBeGreaterThan(20);
        hold(client, 'reverse', 2.5);
        expect(movement(ship).velocity.length).toBeCloseTo(speed, 3);
        release(client, 'accelerate');
        hold(client, 'reverse', 4);
        expect(movement(ship).velocity.length).toBeLessThan(1);
    });

    it('turns an inertial hull to face against its velocity, without '
        + 'braking it', async () => {
        const { client, ship } = await makeHarness(false);
        thrust(client, 3);
        const velocity = movement(ship).velocity;
        expect(velocity.length).toBeGreaterThan(20);
        expect(angleBetween(movement(ship).rotation, velocity.angle))
            .withContext('thrust leaves it facing along its velocity')
            .toBeLessThan(0.01);

        hold(client, 'reverse', 3);
        const after = movement(ship);
        expect(angleBetween(after.rotation, velocity.angle.add(Math.PI)))
            .withContext('faces retrograde')
            .toBeLessThan(0.01);
        expect(after.velocity.length).toBeCloseTo(velocity.length, 3);
        release(client, 'reverse');

        // Thrust while facing back brakes it.
        hold(client, 'accelerate', 0.25);
        expect(movement(ship).velocity.length)
            .toBeLessThan(velocity.length);
    });

    for (const inertialess of [false, true]) {
        const hull = inertialess ? 'inertialess' : 'inertial';
        it(`points an ${hull} hull at its target ship`, async () => {
            const { client, ship, world, gameData, shipId } =
                await makeHarness(inertialess);
            const here = movement(ship).position;
            // A target well off the ship's heading (2.2 rad to its left).
            const offset = movement(ship).rotation.add(-2.2)
                .getUnitVector().scale(500);
            const target = await addParkedShip(world, gameData, shipId,
                new Position(here.x + offset.x, here.y + offset.y));
            client.setTarget(target);
            client.step();
            expect(angleBetween(movement(ship).rotation, offset.angle))
                .toBeGreaterThan(2);

            hold(client, 'pointTo', 3);
            const now = movement(ship);
            const bearingNow = movement(world.entities.get(target)!)
                .position.subtract(now.position).angle;
            expect(angleBetween(now.rotation, bearingNow))
                .withContext('faces the target')
                .toBeLessThan(0.01);
            release(client, 'pointTo');
        });
    }

    async function addParkedShip(world: World,
        gameData: Awaited<ReturnType<typeof getSyntheticGameData>>,
        shipId: string, position: Position) {
        const other = makeShip(await gameData.data.Ship.get(shipId));
        await completeEntity(world, other);
        const state = other.components.get(MovementStateComponent)!;
        other.components.set(MovementStateComponent, {
            ...state, position, velocity: new Vector(0, 0),
        });
        const uuid = 'point-to target';
        world.entities.set(uuid, other);
        return uuid;
    }
});
