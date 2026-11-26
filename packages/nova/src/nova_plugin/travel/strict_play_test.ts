import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultShipData, getDefaultShipPhysics, ShipData } from 'novadatainterface/ship_data';
import { Entity } from 'nova_ecs/entity';
import { MovementPhysicsComponent, MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import { afterburnerFactor, STRICT_PLAY_SPEED_FACTOR } from './afterburner_plugin.js';
import { completeEntity } from '../spawn/index.js';
import { makeShip } from '../ship/index.js';
import { makeSystem } from '../make_system.js';
import { ShipControlStateComponent, StrictPlayComponent } from '../player/index.js';

const SHIP_ID = 'test:ship';
const BASE_SPEED = getDefaultShipPhysics().speed;

/**
 * Strict play cuts the player's top speed to about two thirds and leaves
 * acceleration and turn rate alone (docs/reference_experiments.md, "#316
 * wave 10": 130 vs 88 px/s on one probe hull, turn 29.19 deg/s both,
 * acceleration about 1).
 */
describe('strict play', () => {
    async function makeWorld() {
        const gameData = new MockGameData();
        const shipData: ShipData = {
            ...getDefaultShipData(),
            id: SHIP_ID,
            physics: {
                ...getDefaultShipPhysics(),
                energy: 10000,
                afterburner: 1,
            },
        };
        gameData.data.Ship.map.set(SHIP_ID, shipData);
        const world = await makeSystem('test:system', gameData);
        const add = async (uuid: string, strict: boolean) => {
            const ship = makeShip(shipData);
            if (strict) {
                ship.components.set(StrictPlayComponent, {});
            }
            await completeEntity(world, ship);
            world.entities.set(uuid, ship);
            ship.components.set(ShipControlStateComponent, new Map());
            return ship;
        };
        const strict = await add('strict pilot', true);
        const regular = await add('regular pilot', false);
        await stepWorld(world, 2);
        return { world, strict, regular };
    }

    async function stepWorld(world: World, steps: number) {
        for (let i = 0; i < steps; i++) {
            world.step();
            await new Promise(resolve => setImmediate(resolve));
        }
    }

    function speed(ship: Entity) {
        return ship.components.get(MovementStateComponent)!.velocity.length;
    }

    function physics(ship: Entity) {
        return ship.components.get(MovementPhysicsComponent)!;
    }

    /** Thrusts both ships from rest, recording each tick's speeds. */
    async function thrust(world: World, ships: Entity[], steps: number) {
        for (const ship of ships) {
            ship.components.get(ShipControlStateComponent)!
                .set('accelerate', 'start');
        }
        const speeds: number[][] = ships.map(() => []);
        for (let i = 0; i < steps; i++) {
            await stepWorld(world, 1);
            ships.forEach((ship, index) => speeds[index].push(speed(ship)));
        }
        return speeds;
    }

    it('caps a strict pilot at two thirds of the top speed', async () => {
        const { world, strict, regular } = await makeWorld();
        await thrust(world, [strict, regular], 240);
        expect(speed(regular)).toBeCloseTo(BASE_SPEED, 6);
        expect(speed(strict))
            .toBeCloseTo(BASE_SPEED * STRICT_PLAY_SPEED_FACTOR, 6);
        expect(physics(strict).maxVelocity)
            .toBeCloseTo(BASE_SPEED * STRICT_PLAY_SPEED_FACTOR, 9);
        expect(STRICT_PLAY_SPEED_FACTOR).toBeCloseTo(2 / 3, 12);
    });

    it('leaves acceleration and turn rate alone, so the ramp is shorter',
        async () => {
            const { world, strict, regular } = await makeWorld();
            expect(physics(strict).acceleration)
                .toBe(physics(regular).acceleration);
            expect(physics(strict).turnRate).toBe(physics(regular).turnRate);
            const [strictSpeeds, regularSpeeds] =
                await thrust(world, [strict, regular], 240);
            // The same speed, tick for tick, until the strict cap.
            const cap = BASE_SPEED * STRICT_PLAY_SPEED_FACTOR;
            const below = strictSpeeds.findIndex(s => s >= cap - 1e-9);
            expect(below).toBeGreaterThan(1);
            for (let i = 0; i < below; i++) {
                expect(strictSpeeds[i]).toBeCloseTo(regularSpeeds[i], 9);
            }
            // ...so it reaches its own top speed in about two thirds of
            // the regular ramp (the original: 54 vs 76 frames, 0.71).
            const regularTop = regularSpeeds.findIndex(
                s => s >= BASE_SPEED - 1e-9);
            expect(below / regularTop).toBeCloseTo(2 / 3, 1);
        });

    it('composes with the afterburner boost', async () => {
        const { world, strict } = await makeWorld();
        strict.components.get(ShipControlStateComponent)!
            .set('afterburner', true);
        await stepWorld(world, 240);
        expect(speed(strict)).toBeCloseTo(
            BASE_SPEED * STRICT_PLAY_SPEED_FACTOR * afterburnerFactor(BASE_SPEED), 6);
    });

    it('takes effect, and lifts, with the component', async () => {
        const { world, regular } = await makeWorld();
        await thrust(world, [regular], 240);
        regular.components.set(StrictPlayComponent, {});
        // Over the new cap: the overspeed coasts down rather than snapping
        // (afterburner_plugin's decayedSpeedCap), and settles on the cap.
        await stepWorld(world, 240);
        expect(speed(regular))
            .toBeCloseTo(BASE_SPEED * STRICT_PLAY_SPEED_FACTOR, 6);
        regular.components.delete(StrictPlayComponent);
        await stepWorld(world, 240);
        expect(speed(regular)).toBeCloseTo(BASE_SPEED, 6);
    });
});
