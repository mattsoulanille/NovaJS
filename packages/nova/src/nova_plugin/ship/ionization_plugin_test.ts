import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultShipData, getDefaultShipPhysics, ShipPhysics } from 'novadatainterface/ship_data';
import { MovementPhysicsComponent } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import { DamagedEvent } from './death_plugin.js';
import { completeEntity } from '../spawn/index.js';
import { IonizationComponent } from './health_plugin.js';
import {
    ION_FULL_ACCELERATION_FACTOR, ION_IONIZED_FRACTION, ION_NO_TURN_FRACTION,
    ionizedNow, ionSlowdown, IsIonizedComponent, NO_ION_SLOWDOWN,
} from './ionization_plugin.js';
import { makeShip } from './make_ship.js';
import { makeSystem } from '../make_system.js';

/**
 * Maintainer ruling #153 (ionization_plugin.ts): "ionized" is a LEVEL
 * test with no hysteresis; the line is ION_IONIZED_FRACTION (0.16) of
 * IonizeMax (reference "Ion charge against the turn, in 5-point steps
 * (E6), wave 42"). The slowdown comes in that section's three steps: two
 * thirds of the turn below the line, a third above it, none above
 * ION_NO_TURN_FRACTION (0.38), where the measured full cut (reference
 * "Ionization (E6), wave 39": no turn, a third of the acceleration, the
 * top speed kept) holds. What
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

    it('holds above 0.16 of IonizeMax, and not at or below it (E6 wave '
        + '42: tinted from the 5th 5-point hit, about 17, not the 4th, '
        + 'about 14; a 20-point hit tints at once)', () => {
        expect(ION_IONIZED_FRACTION).toBe(0.16);
        expect(ionizedNow(stat(0))).toBeFalse();
        expect(ionizedNow(stat(14))).toBeFalse();
        expect(ionizedNow(stat(16))).toBeFalse();
        expect(ionizedNow(stat(16.01))).toBeTrue();
        expect(ionizedNow(stat(17))).toBeTrue();
        expect(ionizedNow(stat(20))).toBeTrue();
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
        hit(0.12 * BASE.ionization);
        steps(world, 2);
        expect(ionized()).toBeFalse();
    });

    it('is ionized once the charge is past the ionized line', async () => {
        const { world, hit, ionized } = await ionWorld();
        hit(0.2 * BASE.ionization);
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

    it('gives the movement back in steps as the charge drains, and all '
        + 'of it once the charge is gone', async () => {
            const { world, ship, hit, charge } = await ionWorld();
            hit(BASE.ionization);
            const physics = () =>
                ship.components.get(MovementPhysicsComponent)!;
            const turns: number[] = [];
            while (charge().current > 0) {
                world.step();
                const turn = physics().turnRate / BASE.turnRate;
                if (turns.length === 0
                    || Math.abs(turns[turns.length - 1] - turn) > 1e-9) {
                    turns.push(turn);
                }
            }
            steps(world, 2);
            expect(physics().turnRate).toBeCloseTo(BASE.turnRate, 6);
            expect(physics().acceleration)
                .toBeCloseTo(BASE.acceleration, 6);
            // None, a third, two thirds, all: no values in between.
            expect(turns.length).toBe(4);
            [0, 1 / 3, 2 / 3, 1].forEach((t, i) =>
                expect(turns[i]).toBeCloseTo(t, 9));
        });
});

describe('ionSlowdown', () => {
    const charge = (current: number, max = 100) => ({ current, max });

    it('is nothing at no charge, or on a hull with no ion capacity', () => {
        expect(ionSlowdown(charge(0))).toEqual(NO_ION_SLOWDOWN);
        expect(ionSlowdown(undefined)).toEqual(NO_ION_SLOWDOWN);
        expect(ionSlowdown(charge(10, 0))).toEqual(NO_ION_SLOWDOWN);
    });

    it('is the measured full cut above the second line (0.38)', () => {
        expect(ION_NO_TURN_FRACTION).toBe(0.38);
        for (const current of [38.01, 41, 100, 250]) {
            expect(ionSlowdown(charge(current))).toEqual({
                maxVelocity: 1,
                acceleration: ION_FULL_ACCELERATION_FACTOR,
                turnRate: 0,
            });
        }
    });

    it('comes in three steps, not a ramp (reference "Ion charge against '
        + 'the turn, in 5-point steps (E6), wave 42": about 60 deg/s '
        + 'untinted, 30 tinted, 0 above the second line, control 87.8)',
        () => {
            const at = (current: number) => ionSlowdown(charge(current));
            for (const current of [0.5, 5, 10, 14, 16]) {
                expect(at(current).turnRate).toBeCloseTo(2 / 3, 9);
                // GUESS: the same share of the full acceleration cut.
                expect(at(current).acceleration).toBeCloseTo(7 / 9, 9);
                expect(at(current).maxVelocity).toBe(1);
            }
            for (const current of [16.5, 17, 25, 38]) {
                expect(at(current).turnRate).toBeCloseTo(1 / 3, 9);
                expect(at(current).acceleration).toBeCloseTo(5 / 9, 9);
            }
            expect(87.8 * at(10).turnRate).toBeCloseTo(60, -1);
            expect(87.8 * at(30).turnRate).toBeCloseTo(30, -1);
        });

    it('reproduces wave 42\'s 5-point and 20-point runs with Deionize 1 '
        + 'draining 2 points between hits', () => {
            const drain = 2.0;
            const turnAfterHit = (perHit: number, hits: number) =>
                ionSlowdown(charge(perHit * hits - drain * (hits - 1)))
                    .turnRate;
            expect(turnAfterHit(5, 4)).toBeCloseTo(2 / 3, 9);
            expect(turnAfterHit(5, 5)).toBeCloseTo(1 / 3, 9);
            expect(turnAfterHit(5, 12)).toBeCloseTo(1 / 3, 9);
            expect(turnAfterHit(5, 13)).toBe(0);
            // The 20-point hull: tinted after its first hit.
            expect(turnAfterHit(20, 1)).toBeCloseTo(1 / 3, 9);
        });
});
