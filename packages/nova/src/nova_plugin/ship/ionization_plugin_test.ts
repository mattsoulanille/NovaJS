import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultShipData, getDefaultShipPhysics, ShipPhysics } from 'novadatainterface/ship_data';
import { DEIONIZE_FRAME_RATE } from 'novaparse/parsers/constants';
import { MovementPhysicsComponent } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import { DamagedEvent } from './death_plugin.js';
import { completeEntity } from '../spawn/index.js';
import { IonizationComponent } from './health_plugin.js';
import {
    ION_ACCELERATION_SLOPE, ION_FULL_ACCELERATION_FACTOR,
    ION_IONIZED_FRACTION, ION_NO_TURN_FRACTION, ionizedNow, ionSlowdown,
    IsIonizedComponent, NO_ION_SLOWDOWN,
} from './ionization_plugin.js';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { makeShip } from './make_ship.js';
import { makeSystem } from '../make_system.js';

/**
 * Maintainer ruling #153 (ionization_plugin.ts): "ionized" is a LEVEL
 * test with no hysteresis; the line is ION_IONIZED_FRACTION (a third) of
 * IonizeMax (reference "The ion charge read directly (E6, the hub's item
 * 2), wave 50"). The turn comes in three steps: two thirds of the turn
 * below the line, a third above it, none above ION_NO_TURN_FRACTION (two
 * thirds), where the measured full cut (reference "Ionization (E6), wave
 * 39": no turn, the top speed kept; 0.4 of the acceleration, wave 44)
 * holds; the acceleration slides 1 - 0.9 q down to that 0.4. What
 * #124 fixed alongside stays pinned here: a hull with no ion capacity is
 * never ionized and never shows a NaN percent.
 */

const SHIP_ID = 'test:ship';
const SHIP = 'ship under test';
const BASE = getDefaultShipPhysics();

/** shïp Deionize 1 as the parser reads it (DEIONIZE_FRAME_RATE). */
const DEIONIZE_1 = DEIONIZE_FRAME_RATE / 100;

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

    /** Queues one ion hit, landing on the next step. */
    const emitHit = (ionization: number) => {
        world.emit(DamagedEvent, {
            damage: {
                shield: 0, armor: 0, ionization, ionizationColor: 0xff0000ff,
                knockback: 0, passThroughShield: 1,
            },
            damager: 'attacker',
        }, [SHIP]);
    };
    const hit = (ionization: number) => {
        emitHit(ionization);
        world.step();
    };
    const charge = () => ship.components.get(IonizationComponent)!;
    const ionized = () => ship.components.get(IsIonizedComponent) === true;
    const time = world.resources.get(TimeResource)!;
    const start = time.time;
    /** Game seconds since the world was built. */
    const elapsed = () => (time.time - start) / 1000;
    const movement = () => ship.components.get(MovementPhysicsComponent)!;
    const turn = () => movement().turnRate / BASE.turnRate;
    const thrust = () => movement().acceleration / BASE.acceleration;
    return {
        world, ship, hit, emitHit, charge, ionized, elapsed, turn, thrust,
    };
}

function steps(world: World, n: number) {
    for (let i = 0; i < n; i++) {
        world.step();
    }
}

describe('ionizedNow (the level rule, #153)', () => {
    const stat = (current: number, max = 100) => ({ current, max, min: 0 });

    it('holds above a third of IonizeMax, and not at or below it (E6 wave '
        + '50: 5-point ticks tinted at 35.5 / 35.2, not at 31.4 / 32.0; '
        + 'the two-hit charge untinted at 33.0)', () => {
        expect(ION_IONIZED_FRACTION).toBe(1 / 3);
        expect(ionizedNow(stat(0))).toBeFalse();
        expect(ionizedNow(stat(30))).toBeFalse();
        expect(ionizedNow(stat(31.4))).toBeFalse();
        expect(ionizedNow(stat(32.0))).toBeFalse();
        expect(ionizedNow(stat(33.0))).toBeFalse();
        expect(ionizedNow(stat(33.33))).toBeFalse();
        expect(ionizedNow(stat(33.34))).toBeTrue();
        expect(ionizedNow(stat(35.2))).toBeTrue();
        expect(ionizedNow(stat(35.5))).toBeTrue();
        expect(ionizedNow(stat(58.9))).toBeTrue();
        expect(ionizedNow(stat(100))).toBeTrue();
        expect(ionizedNow(stat(170))).toBeTrue();
        // It scales with IonizeMax.
        expect(ionizedNow(stat(66, 200))).toBeFalse();
        expect(ionizedNow(stat(67, 200))).toBeTrue();
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
        hit(0.3 * BASE.ionization);
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

    it('at a full charge: no turn, 0.4 of the acceleration, the top '
        + 'speed kept (reference "Ionization (E6), wave 39"; the thrust '
        + '"Acceleration under ionization (E6 leftover), wave 44")',
        async () => {
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

    it('thrusts on the slide below the no-turn line and at the full cut '
        + 'above it (reference "The ion charge read directly (E6, the '
        + 'hub\'s item 2), wave 50", finding 5)', async () => {
            const { world, hit, charge, turn, thrust } =
                await ionWorld({ deionize: 0 });
            // Tinted, short of the no-turn line.
            hit(BASE.ionization * 0.5);
            steps(world, 2);
            const fraction = charge().current / BASE.ionization;
            expect(fraction).toBeGreaterThan(ION_IONIZED_FRACTION);
            expect(fraction).toBeLessThan(ION_NO_TURN_FRACTION);
            expect(turn()).toBeCloseTo(1 / 3, 9);
            expect(thrust()).toBeCloseTo(1 - 0.9 * fraction, 6);
            expect(thrust()).toBeCloseTo(0.55, 6);
            // Charged on past the no-turn line: both full cuts.
            hit(BASE.ionization * 0.2);
            steps(world, 2);
            expect(turn()).toBe(0);
            expect(thrust()).toBeCloseTo(ION_FULL_ACCELERATION_FACTOR, 6);
        });

    it('gives the movement back in steps as the charge drains, and all '
        + 'of it once the charge is gone', async () => {
            const { world, hit, charge, turn, thrust } = await ionWorld();
            hit(BASE.ionization);
            const turns: number[] = [];
            while (charge().current > 0) {
                world.step();
                const now = turn();
                if (turns.length === 0
                    || Math.abs(turns[turns.length - 1] - now) > 1e-9) {
                    turns.push(now);
                }
            }
            steps(world, 2);
            expect(turn()).toBeCloseTo(1, 6);
            expect(thrust()).toBeCloseTo(1, 6);
            // None, a third, two thirds, all: no values in between.
            expect(turns.length).toBe(4);
            [0, 1 / 3, 2 / 3, 1].forEach((t, i) =>
                expect(turns[i]).toBeCloseTo(t, 9));
        });
});

/**
 * Reference "The ion charge read directly (E6, the hub's item 2), wave
 * 50": wave 39's Kit Ring Ion (IonizeMax 100, Deionize 1) under wëap 329
 * Kit Ion Shot 30 (Ionization 30) and wave 45's Ionization-5 tick. Game
 * time here is the nominal 30 fps clock; the reference machine ran at
 * 29.13 Hz, so its seconds are 30 / 29.13 = 1.03 of these.
 */
describe('the ion charge against the clock (reference E6, wave 50)', () => {
    const REFERENCE_SECONDS = 30 / 29.13;

    it('holds the two-thirds turn for about 103 s after one 30-point hit '
        + 'on IonizeMax 100 / Deionize 1, never tinted, then gives it all '
        + 'back (e6k_c / e6k_e: 102.9 / 103.0 s)', async () => {
            const { world, hit, ionized, elapsed, turn, thrust, charge } =
                await ionWorld({ ionization: 100, deionize: DEIONIZE_1 });
            hit(30);
            world.step();
            const from = elapsed();
            expect(turn()).toBeCloseTo(2 / 3, 9);
            // The slide: 1 - 0.9 x 0.3 just after the hit.
            expect(thrust()).toBeCloseTo(0.73, 2);
            let tinted = false;
            while (turn() < 1) {
                expect(turn()).toBeCloseTo(2 / 3, 9);
                tinted ||= ionized();
                world.step();
            }
            const held = elapsed() - from;
            expect(tinted).toBeFalse();
            expect(charge().current).toBe(0);
            expect(thrust()).toBe(1);
            // 30 / 0.30 = 100 s of game time ...
            expect(held).toBeGreaterThan(99.9);
            expect(held).toBeLessThan(100.2);
            // ... which the reference machine's clock read as 103.
            expect(Math.abs(held * REFERENCE_SECONDS - 103)).toBeLessThan(0.3);
        }, 120_000);

    it('tints two 30-point hits until the drain takes them to a third, '
        + 'turning at a third meanwhile and at two thirds after '
        + '(e6k_d: tinted 36.37 -> 125.13 s on the reference clock)',
        async () => {
            const { world, hit, emitHit, ionized, elapsed, turn, charge } =
                await ionWorld({ ionization: 100, deionize: DEIONIZE_1 });
            hit(30);
            // The second hit 3.77 reference seconds later.
            const second = elapsed() + 3.77 / REFERENCE_SECONDS;
            while (elapsed() < second) {
                world.step();
            }
            emitHit(30);
            world.step();
            world.step();
            const from = elapsed();
            expect(ionized()).toBeTrue();
            expect(turn()).toBeCloseTo(1 / 3, 9);
            while (ionized()) {
                // The tint follows the charge one tick late (IonizedSystem
                // judges last tick's charge before the drain); the turn
                // reads this tick's.
                if (charge().current > 100 / 3 + 0.01) {
                    expect(turn()).toBeCloseTo(1 / 3, 9);
                }
                world.step();
            }
            const tinted = (elapsed() - from) * REFERENCE_SECONDS;
            // 88.8 s read (from the second hit's own frame); the model,
            // with the drain of the 3.77 s between hits: about 87.6.
            expect(Math.abs(tinted - (125.13 - 36.37))).toBeLessThan(2);
            expect(turn()).toBeCloseTo(2 / 3, 9);
        }, 120_000);

    it('never turns under six 30-point hits for 170 s (e6k_a)', async () => {
        const { world, hit, elapsed, turn } =
            await ionWorld({ ionization: 100, deionize: DEIONIZE_1 });
        for (let i = 0; i < 6; i++) {
            hit(30);
            steps(world, 100);
        }
        const until = elapsed() + 170;
        while (elapsed() < until) {
            expect(turn()).toBe(0);
            world.step();
        }
    }, 120_000);

    it('tints the 5-point rise at its 9th hit and stops the turn at its '
        + '17th (e6r_a; wave 42 recounted), the thrust sliding pulse by '
        + 'pulse on 1 - 0.9 q (waves 47 / 48 re-mapped)', async () => {
            const { world, emitHit, ionized, elapsed, turn, thrust } =
                await ionWorld({ ionization: 100, deionize: DEIONIZE_1 });
            const from = elapsed();
            const since = () => elapsed() - from;
            // Wave 48's e6p cadence: hits at Leave + 0.26 + 3.587 k.
            let hits = 0;
            const hitTimes: number[] = [];
            let firstTinted = 0;
            let firstStopped = 0;
            const runTo = (seconds: number) => {
                while (since() < seconds) {
                    if (since() >= 0.26 + 3.587 * hits) {
                        emitHit(5);
                        hits++;
                        hitTimes.push(since());
                    }
                    world.step();
                    if (!firstTinted && ionized()) {
                        firstTinted = hits;
                    }
                    if (!firstStopped && turn() === 0) {
                        firstStopped = hits;
                    }
                }
            };
            // Each 0.37 s Up pulse read at its middle (waves 47 / 48).
            const pulses: [number, number][] = [
                [15.2, 0.84], [18.6, 0.80], [22.2, 0.77], [25.6, 0.72],
                [30.0, 0.71], [33.5, 0.64],
                [36.2, 0.53], [39.6, 0.63], [44.2, 0.52], [47.6, 0.46],
                [52.2, 0.43], [55.6, 0.39],
            ];
            let squares = 0;
            for (const [at, read] of pulses) {
                runTo(at + 0.185);
                const error = thrust() - read;
                squares += error * error;
                expect(Math.abs(error)).withContext(`${at} s`)
                    .toBeLessThan(0.1);
            }
            expect(Math.sqrt(squares / pulses.length)).toBeLessThan(0.05);
            runTo(75);
            expect(firstTinted).toBe(9);
            expect(firstStopped).toBe(17);
        }, 120_000);
});

describe('ionSlowdown', () => {
    const charge = (current: number, max = 100) => ({ current, max });

    it('is nothing at no charge, or on a hull with no ion capacity', () => {
        expect(ionSlowdown(charge(0))).toEqual(NO_ION_SLOWDOWN);
        expect(ionSlowdown(undefined)).toEqual(NO_ION_SLOWDOWN);
        expect(ionSlowdown(charge(10, 0))).toEqual(NO_ION_SLOWDOWN);
    });

    it('stops the turn and cuts the thrust to 0.4 above two thirds',
        () => {
            expect(ION_NO_TURN_FRACTION).toBe(2 / 3);
            // Wave 44: 19.6 / 22.3 px/s² against the control's 52.0 / 49.8.
            expect(ION_FULL_ACCELERATION_FACTOR).toBe(0.4);
            for (const current of [58.9, 65.4, 66.6]) {
                expect(ionSlowdown(charge(current)).turnRate)
                    .withContext(`${current}`).toBeCloseTo(1 / 3, 9);
            }
            for (const current of [66.7, 68.1, 100, 170, 250]) {
                expect(ionSlowdown(charge(current))).withContext(`${current}`)
                    .toEqual({
                        maxVelocity: 1,
                        acceleration: ION_FULL_ACCELERATION_FACTOR,
                        turnRate: 0,
                    });
            }
        });

    it('comes in three steps on the turn, not a ramp (wave 42 / 50: about '
        + '58 deg/s untinted, 30 tinted, 0 above the second line, control '
        + '87.6-87.8)', () => {
            const at = (current: number) => ionSlowdown(charge(current));
            for (const current of [0.5, 5, 16, 30, 33.3]) {
                expect(at(current).turnRate).toBeCloseTo(2 / 3, 9);
                expect(at(current).maxVelocity).toBe(1);
            }
            for (const current of [33.4, 40, 58.9, 66.6]) {
                expect(at(current).turnRate).toBeCloseTo(1 / 3, 9);
            }
            expect(87.6 * at(30).turnRate).toBeCloseTo(58.4, 1);
            expect(87.8 * at(50).turnRate).toBeCloseTo(30, -1);
        });

    it('slides the thrust as ONE line in the charge, 1 - 0.9 q, from the '
        + 'first point to 0.4 at the no-turn line (reference "The ion '
        + 'charge read directly (E6, the hub\'s item 2), wave 50", '
        + 'finding 5)', () => {
            const accel = (current: number) =>
                ionSlowdown(charge(current)).acceleration;
            expect(ION_ACCELERATION_SLOPE).toBe(0.9);
            expect(accel(0.0001)).toBeCloseTo(1, 4);
            expect(accel(10)).toBeCloseTo(0.91, 9);
            expect(accel(30)).toBeCloseTo(0.73, 9);
            expect(accel(50)).toBeCloseTo(0.55, 9);
            expect(accel(100 * ION_NO_TURN_FRACTION)).toBeCloseTo(0.4, 9);
            // The free fit (1.03 - 1.01 q) within 0.05 over the slide.
            for (let current = 5; current <= 60; current += 5) {
                expect(Math.abs(accel(current) - (1.03 - 1.01 * current / 100)))
                    .withContext(`${current}`).toBeLessThan(0.05);
            }
            // No plateau and no step at either line.
            let last = Infinity;
            for (let current = 0.5; current <= 66.5; current += 0.5) {
                expect(accel(current)).withContext(`${current}`)
                    .toBeLessThan(last);
                if (last !== Infinity) {
                    expect(last - accel(current)).withContext(`${current}`)
                        .toBeLessThan(0.0046);
                }
                last = accel(current);
            }
            // It scales with IonizeMax like the lines do.
            expect(ionSlowdown(charge(54, 200)).acceleration)
                .toBeCloseTo(accel(27), 9);
            expect(ionSlowdown(charge(90, 200)).acceleration)
                .toBeCloseTo(accel(45), 9);
        });
});
