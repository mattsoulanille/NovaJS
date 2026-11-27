import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultShipData, getDefaultShipPhysics, ShipPhysics } from 'novadatainterface/ship_data';
import { MovementPhysicsComponent } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import { DamagedEvent } from './death_plugin.js';
import { completeEntity } from '../spawn/index.js';
import { IonizationComponent } from './health_plugin.js';
import {
    ION_FULL_ACCELERATION_FACTOR, ION_IONIZED_FRACTION, ionizedNow,
    ionSlowdown, IsIonizedComponent, NO_ION_SLOWDOWN,
} from './ionization_plugin.js';
import { makeShip } from './make_ship.js';
import { makeSystem } from '../make_system.js';

/**
 * Maintainer ruling #153 (ionization_plugin.ts): "ionized" is a LEVEL
 * test with no hysteresis; the line is ION_IONIZED_FRACTION (0.3) of
 * IonizeMax (reference "Ionization below a full charge (E6 leftover),
 * wave 41"). The slowdown is the measured one (reference "Ionization
 * (E6), wave 39"): no turn, a third of the acceleration, the top speed
 * kept, from the ionized line up; below it linear in the charge from
 * nothing (GUESS; wave 41: a sub-line charge already slows the turn). What
 * #124 fixed alongside stays pinned here: a hull with no ion capacity is
 * never ionized and never shows a NaN percent.
 */

const SHIP_ID = 'test:ship';
const SHIP = 'ship under test';
const BASE = getDefaultShipPhysics();

async function ionWorld(physics: Partial<ShipPhysics> = {}) {
    const gameData = new MockGameData();
    gameData.data.Ship.map.set(SHIP_ID, {
        ...getDefaultShipData(), id: SHIP_ID,
        physics: { ...BASE, ...physics },
    });
    const world = await makeSystem('test:system', gameData);
    const ship = makeShip(gameData.data.Ship.map.get(SHIP_ID)!);
    await completeEntity(world, ship);
    world.entities.set(SHIP, ship);
    world.step();

    const hit = (ionization: number) => {
        world.emit(DamagedEvent, {
            damage: {
                shield: 0, armor: 0, ionization, ionizationColor: 0xff0000ff,
                knockback: 0, passThroughShield: 1,
            },
            damager: 'attacker',
        }, [SHIP]);
        world.step();
    };
    const charge = () => ship.components.get(IonizationComponent)!;
    const ionized = () => ship.components.get(IsIonizedComponent) === true;
    return { world, ship, hit, charge, ionized };
}

function steps(world: World, n: number) {
    for (let i = 0; i < n; i++) {
        world.step();
    }
}

describe('ionizedNow (the level rule, #153)', () => {
    const stat = (current: number, max = 100) => ({ current, max, min: 0 });

    it('holds above 0.3 of IonizeMax, and not at or below it (E6 wave '
        + '41: one 20-point hit no tint, two about 39 tinted)', () => {
        expect(ION_IONIZED_FRACTION).toBe(0.3);
        expect(ionizedNow(stat(0))).toBeFalse();
        expect(ionizedNow(stat(20))).toBeFalse();
        expect(ionizedNow(stat(30))).toBeFalse();
        expect(ionizedNow(stat(30.01))).toBeTrue();
        expect(ionizedNow(stat(39))).toBeTrue();
        expect(ionizedNow(stat(100))).toBeTrue();
        expect(ionizedNow(stat(140))).toBeTrue();
    });

    it('never holds for a hull with no ion capacity', () => {
        expect(ionizedNow(stat(0, 0))).toBeFalse();
        expect(ionizedNow(stat(20, 0))).toBeFalse();
        expect(ionizedNow(stat(20, -5))).toBeFalse();
    });
});

describe('ionization in a live world', () => {
    it('is not ionized at a charge below the ionized line', async () => {
        const { world, hit, ionized } = await ionWorld();
        hit(0.25 * BASE.ionization);
        steps(world, 2);
        expect(ionized()).toBeFalse();
    });

    it('is ionized once the charge is past the ionized line', async () => {
        const { world, hit, ionized } = await ionWorld();
        hit(0.4 * BASE.ionization);
        world.step();
        expect(ionized()).toBeTrue();
    });

    it('is ionized at IonizeMax', async () => {
        const { world, hit, ionized } = await ionWorld();
        hit(BASE.ionization);
        steps(world, 2);
        expect(ionized()).toBeTrue();
    });

    it('piles the charge up past IonizeMax and drains the whole pile '
        + '(reference "Ionization\'s cap and the afterburner (E6 '
        + 'leftovers), wave 40")', async () => {
            const { world, hit, ionized, charge } = await ionWorld();
            hit(BASE.ionization * 3);
            hit(BASE.ionization * 3);
            expect(charge().current).toBeGreaterThan(5 * BASE.ionization);
            // Draining past IonizeMax takes as long as the extra charge
            // says, and the ship is ionized throughout.
            const perTick = charge().recharge;
            expect(perTick).toBeLessThan(0);
            let ticks = 0;
            while (charge().current > BASE.ionization) {
                expect(ionized()).toBeTrue();
                world.step();
                ticks++;
            }
            expect(ticks).toBeGreaterThan(1);
            expect(ionized()).toBeTrue();
        });

    it('frees the ship the tick its charge decays to the line, not when '
        + 'it is gone (no hysteresis)', async () => {
            const { world, hit, ionized, charge } = await ionWorld();
            hit(BASE.ionization);
            world.step();
            expect(ionized()).toBeTrue();
            const line = BASE.ionization * ION_IONIZED_FRACTION;
            // Above the line, every tick of the way: still ionized.
            let droppedEarly = false;
            while (charge().current > line) {
                droppedEarly ||= !ionized();
                world.step();
            }
            expect(droppedEarly).toBeFalse();
            // At or below it: free (one tick for the state to follow),
            // with plenty of charge still on the hull.
            world.step();
            expect(charge().current).toBeGreaterThan(0);
            expect(ionized()).toBeFalse();
        });

    it('a hull with IonizeMax 0 is never ionized and never shows NaN',
        async () => {
            const { world, hit, ionized, charge } =
                await ionWorld({ ionization: 0, deionize: 0 });
            hit(20);
            for (let i = 0; i < 3; i++) {
                expect(ionized()).toBeFalse();
                expect(Number.isFinite(charge().percent)).toBeTrue();
                world.step();
            }
            expect(charge().current).toBe(0);
            expect(charge().percent).toBe(0);
        });

    it('at a full charge: no turn, a third of the acceleration, the top '
        + 'speed kept (reference "Ionization (E6), wave 39")', async () => {
            const { world, ship, hit, charge } = await ionWorld();
            hit(BASE.ionization * 3);
            steps(world, 2);
            const physics = ship.components.get(MovementPhysicsComponent)!;
            expect(physics.maxVelocity).toBeCloseTo(BASE.speed, 6);
            // The charge is not capped (E6, wave 40): three times
            // IonizeMax, less two ticks of Deionize, is still past it,
            // and the cut saturates at the measured full one.
            expect(charge().current).toBeGreaterThan(BASE.ionization);
            expect(physics.acceleration).toBeCloseTo(
                BASE.acceleration * ION_FULL_ACCELERATION_FACTOR, 6);
            expect(physics.turnRate).toBeCloseTo(0, 6);
        });

    it('gives the movement back as the charge drains below the line, '
        + 'and all of it once the charge is gone', async () => {
            const { world, ship, hit, charge } = await ionWorld();
            hit(BASE.ionization);
            const physics = () =>
                ship.components.get(MovementPhysicsComponent)!;
            while (charge().current > BASE.ionization * 0.15) {
                world.step();
            }
            // Partway down: some turn back, not all of it.
            expect(physics().turnRate).toBeGreaterThan(0);
            expect(physics().turnRate).toBeLessThan(BASE.turnRate * 0.6);
            while (charge().current > 0) {
                world.step();
            }
            steps(world, 2);
            expect(physics().turnRate).toBeCloseTo(BASE.turnRate, 6);
            expect(physics().acceleration)
                .toBeCloseTo(BASE.acceleration, 6);
        });
});

describe('ionSlowdown', () => {
    const charge = (current: number, max = 100) => ({ current, max });

    it('is nothing at no charge, or on a hull with no ion capacity', () => {
        expect(ionSlowdown(charge(0))).toEqual(NO_ION_SLOWDOWN);
        expect(ionSlowdown(undefined)).toEqual(NO_ION_SLOWDOWN);
        expect(ionSlowdown(charge(10, 0))).toEqual(NO_ION_SLOWDOWN);
    });

    it('is the measured full cut from the ionized line up', () => {
        for (const current of [30, 39, 100, 250]) {
            expect(ionSlowdown(charge(current))).toEqual({
                maxVelocity: 1,
                acceleration: ION_FULL_ACCELERATION_FACTOR,
                turnRate: 0,
            });
        }
    });

    it('already slows a charge below the line, linearly from nothing '
        + '(E6 wave 41: a 20-of-100 hit, never tinted, cut the turn to '
        + 'about two thirds as it drained; the ramp is a GUESS)', () => {
        const at = (current: number) => ionSlowdown(charge(current));
        expect(at(15).turnRate).toBeCloseTo(0.5, 9);
        expect(at(15).acceleration).toBeCloseTo(2 / 3, 9);
        expect(at(15).maxVelocity).toBe(1);
        expect(at(5).turnRate).toBeCloseTo(5 / 6, 9);
        // The dips read 58 / 68 deg/s against 87.8 over the 10-frame
        // windows a 1-a-frame drain takes from 20 to 10 and 10 to 0.
        const mean = (from: number, to: number) => {
            let sum = 0;
            for (let c = from; c > to; c--) {
                sum += at(c - 0.5).turnRate;
            }
            return 87.8 * sum / (from - to);
        };
        expect(mean(20, 10)).toBeGreaterThan(40);
        expect(mean(20, 10)).toBeLessThan(65);
        expect(mean(10, 0)).toBeGreaterThan(65);
        expect(mean(10, 0)).toBeLessThan(85);
    });
});
