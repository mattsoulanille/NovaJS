import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultShipData, getDefaultShipPhysics, ShipPhysics } from 'novadatainterface/ship_data';
import {
    DEIONIZE_FRAME_RATE, ShipAccelerationConversionFactor,
    ShipTurnRateConversionFactor,
} from 'novaparse/parsers/constants';
import { MovementPhysicsComponent } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import { DamagedEvent } from './death_plugin.js';
import { completeEntity } from '../spawn/index.js';
import { IonizationComponent } from './health_plugin.js';
import {
    ION_CHARGE_HOLD, ION_FULL_ACCELERATION_FACTOR, ION_IONIZED_FRACTION,
    ION_TURN_STEP, ionizedNow, ionSlowdown, IsIonizedComponent,
    NO_ION_SLOWDOWN,
} from './ionization_plugin.js';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { makeShip } from './make_ship.js';
import { makeSystem } from '../make_system.js';

/**
 * Maintainer ruling #153 (ionization_plugin.ts): "ionized" is a LEVEL
 * test with no hysteresis; the line is ION_IONIZED_FRACTION (a third) of
 * IonizeMax (reference "The ion charge read directly (E6, the hub's item
 * 2), wave 50"). The movement cuts are in the charge share q held at
 * ION_CHARGE_HOLD (0.7) and do not look at that line (wave 51): the turn
 * is floor(Turn / 10 x (1 - q)) whole degrees a frame, so it is cut per
 * hull (the Turn-30 rings of waves 39-50 showed its two thirds / a third
 * / none at 1/3 and 2/3); the thrust is 1 - q, 0.3 at the hold; the top
 * speed is kept ("Ionization (E6), wave 39"). What #124 fixed alongside
 * stays pinned here: a hull with no ion capacity is never ionized and
 * never shows a NaN percent.
 */

const SHIP_ID = 'test:ship';
const SHIP = 'ship under test';
const BASE = getDefaultShipPhysics();

/** shïp Deionize 1 as the parser reads it (DEIONIZE_FRAME_RATE). */
const DEIONIZE_1 = DEIONIZE_FRAME_RATE / 100;

/** shïp Turn `n` as the parser reads it (rad/s). */
const TURN = (n: number) => n * ShipTurnRateConversionFactor;

/** shïp Accel `n` as the parser reads it (px/s²). */
const ACCEL = (n: number) => n * ShipAccelerationConversionFactor;

/** Wave 39's Kit Ring Ion: Turn 30, IonizeMax 100, Deionize 1. */
const RING_ION = { turnRate: TURN(30), ionization: 100, deionize: DEIONIZE_1 };

/** One degree a frame on the reference machine's 29.15 Hz tick, deg/s. */
const REFERENCE_STEP = 29.15;

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
    const full = { ...BASE, ...physics };
    const turn = () => movement().turnRate / full.turnRate;
    /** The turn in whole degrees a 1/30 s frame (ION_TURN_STEP). */
    const degrees = () => movement().turnRate / ION_TURN_STEP;
    const thrust = () => movement().acceleration / full.acceleration;
    return {
        world, ship, hit, emitHit, charge, ionized, elapsed, turn, degrees,
        thrust,
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

    it('at a full charge on a Turn-30 hull: no turn, 0.3 of the '
        + 'acceleration, the top speed kept (reference "Ionization (E6), '
        + 'wave 39"; the thrust "The saturated thrust cut on two Accels '
        + '(Matthew\'s question, E6), wave 51")',
        async () => {
            const { world, ship, hit, charge } =
                await ionWorld({ turnRate: TURN(30) });
            hit(BASE.ionization * 3);
            steps(world, 2);
            const physics = ship.components.get(MovementPhysicsComponent)!;
            expect(physics.maxVelocity).toBeCloseTo(BASE.speed, 6);
            // The charge is not capped (E6, wave 40): three times
            // IonizeMax, less two ticks of Deionize, is still past it,
            // and the cut saturates at the hold (ION_CHARGE_HOLD).
            expect(charge().current).toBeGreaterThan(BASE.ionization);
            expect(physics.acceleration).toBeCloseTo(
                BASE.acceleration * ION_FULL_ACCELERATION_FACTOR, 6);
            expect(physics.turnRate).toBeCloseTo(0, 6);
        });

    it('thrusts on the slide 1 - q below the hold and at its 0.3 past '
        + 'it (reference wave 50 finding 5; wave 51\'s saturated thrust), '
        + 'the Turn-30 turn at a third tinted and none past two thirds',
        async () => {
            const { world, hit, charge, turn, thrust } =
                await ionWorld({ deionize: 0, turnRate: TURN(30) });
            // Tinted, short of two thirds.
            hit(BASE.ionization * 0.5);
            steps(world, 2);
            const fraction = charge().current / BASE.ionization;
            expect(fraction).toBeGreaterThan(ION_IONIZED_FRACTION);
            expect(fraction).toBeLessThan(2 / 3);
            expect(turn()).toBeCloseTo(1 / 3, 9);
            expect(thrust()).toBeCloseTo(1 - fraction, 6);
            expect(thrust()).toBeCloseTo(0.5, 6);
            // Charged on past the hold: both at their saturation.
            hit(BASE.ionization * 0.3);
            steps(world, 2);
            expect(turn()).toBe(0);
            expect(thrust()).toBeCloseTo(ION_FULL_ACCELERATION_FACTOR, 6);
        });

    it('gives a Turn-30 hull its turn back in steps as the charge '
        + 'drains, and all of it once the charge is gone', async () => {
            const { world, hit, charge, turn, thrust } =
                await ionWorld({ turnRate: TURN(30) });
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
                await ionWorld(RING_ION);
            hit(30);
            world.step();
            const from = elapsed();
            expect(turn()).toBeCloseTo(2 / 3, 9);
            // The slide: 1 - 0.3 just after the hit.
            expect(thrust()).toBeCloseTo(0.7, 2);
            let tinted = false;
            while (turn() < 1 - 1e-9) {
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
                await ionWorld(RING_ION);
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
            await ionWorld(RING_ION);
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
        + 'pulse on 1 - q (waves 47 / 48 re-mapped)', async () => {
            const { world, emitHit, ionized, elapsed, turn, thrust } =
                await ionWorld(RING_ION);
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
            // 1 - q runs about 0.025 under these pulses' own free fit
            // (1.03 - 1.01 q): wave 51's saturated 0.3 pins the slope at 1
            // from no charge. The 39.6 s pulse (0.63, between 0.53 and
            // 0.52) is the farthest, 0.11.
            let squares = 0;
            for (const [at, read] of pulses) {
                runTo(at + 0.185);
                const error = thrust() - read;
                squares += error * error;
                expect(Math.abs(error)).withContext(`${at} s`)
                    .toBeLessThan(0.12);
            }
            expect(Math.sqrt(squares / pulses.length)).toBeLessThan(0.06);
            runTo(75);
            expect(firstTinted).toBe(9);
            expect(firstStopped).toBe(17);
        }, 120_000);
});

/**
 * Reference "The ion turn cut on every hull (Matthew's question, E6), wave
 * 51" and "The saturated thrust cut on two Accels (Matthew's question,
 * E6), wave 51": wave 50's ion clock (Kit Ion Shot 30 on IonizeMax 100,
 * Deionize 1) on the Kit Ring Ion at Turn 10 / 20 / 30 / 60 / 100 / 200,
 * and the Kit Probe Ion at Accel 300 / 900.
 */
describe('the ion cut per hull (reference E6, wave 51)', () => {
    const REFERENCE_SECONDS = 30 / 29.13;
    const hull = (turn: number) => ({ ...RING_ION, turnRate: TURN(turn) });

    it('stops a Turn-10 hull from the first point of charge, and a Turn-20 '
        + 'one once q passes a half', async () => {
            for (const ionization of [5, 30]) {
                const { hit, degrees } = await ionWorld(hull(10));
                expect(degrees()).toBeCloseTo(1, 9);
                hit(ionization);
                expect(degrees()).withContext(`${ionization}`).toBe(0);
            }
            const { world, hit, degrees, charge } = await ionWorld(hull(20));
            hit(30);
            hit(30);
            // Draining from about 60: none above a half, 1 a frame below.
            let turnedAt = 0;
            while (charge().current > 40) {
                world.step();
                if (degrees() > 0 && !turnedAt) {
                    turnedAt = charge().current;
                }
                expect(degrees()).toBeCloseTo(charge().current > 50 ? 0 : 1, 9);
            }
            expect(turnedAt).toBeGreaterThan(49.9);
            expect(turnedAt).toBeLessThanOrEqual(50);
        }, 120_000);

    it('keeps the fast hulls turning when saturated: Turn 60 / 100 / 200 '
        + 'at 1 / 3 / 6 degrees a frame (29.2 / 87.5 / 174.5 deg/s read), '
        + 'Turn 10 / 20 / 30 at none, six hits the same as three',
        async () => {
            const cases: [number, number, number | undefined][] = [
                [10, 0, undefined], [20, 0, undefined], [30, 0, undefined],
                [60, 1, 29.2], [100, 3, 87.5], [200, 6, 174.5],
            ];
            for (const [turn, perFrame, read] of cases) {
                for (const hits of [3, 6]) {
                    const { world, hit, degrees } = await ionWorld(hull(turn));
                    for (let i = 0; i < hits; i++) {
                        hit(30);
                        steps(world, 100);
                    }
                    expect(degrees()).withContext(`Turn ${turn}, ${hits} hits`)
                        .toBeCloseTo(perFrame, 9);
                    if (read !== undefined) {
                        expect(Math.abs(perFrame * REFERENCE_STEP - read))
                            .withContext(`Turn ${turn}`).toBeLessThan(1);
                    }
                }
            }
        }, 120_000);

    it('climbs Turn 200 one degree a frame at a time, 8 -> 15 and on, as a '
        + 'two-hit charge drains (k2_t200: each step where floor(20 x (1 - '
        + 'q)) puts it)', async () => {
            const { world, hit, emitHit, elapsed, degrees, charge } =
                await ionWorld(hull(200));
            hit(30);
            const second = elapsed() + 3.77 / REFERENCE_SECONDS;
            while (elapsed() < second) {
                world.step();
            }
            emitHit(30);
            world.step();
            const levels: number[] = [degrees()];
            // The read windows: 8 at q 0.57, 9 from 0.54, 10 from 0.50,
            // 11 from 0.44, 12 from 0.39, 13 from 0.34, 14 from 0.29, 15
            // from 0.25.
            const read: [number, number][] = [
                [0.57, 8], [0.54, 9], [0.50, 10], [0.44, 11], [0.39, 12],
                [0.34, 13], [0.29, 14], [0.25, 15],
            ];
            let next = 0;
            while (charge().current > 0) {
                world.step();
                const q = charge().current / 100;
                if (next < read.length && q <= read[next][0]) {
                    expect(degrees()).withContext(`q ${q}`)
                        .toBeCloseTo(read[next][1], 9);
                    next++;
                }
                if (Math.abs(levels[levels.length - 1] - degrees()) > 1e-9) {
                    levels.push(degrees());
                }
            }
            expect(next).toBe(read.length);
            // Whole degrees a frame, one step at a time, then the
            // uncharged 20.
            expect(levels.map(level => Math.round(level * 1e6) / 1e6))
                .toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
        }, 120_000);

    it('cuts the thrust to about 0.3 at saturation on Accel 300 and Accel '
        + '900 alike (a6_pion 0.28, a6_p900 0.32, +- 0.03)', async () => {
            for (const [accel, read] of [[300, 0.28], [900, 0.32]]) {
                const { world, hit, thrust } =
                    await ionWorld({ ...RING_ION, acceleration: ACCEL(accel) });
                for (let i = 0; i < 6; i++) {
                    hit(30);
                    steps(world, 100);
                }
                expect(thrust()).toBeCloseTo(0.3, 9);
                expect(Math.abs(thrust() - read)).withContext(`Accel ${accel}`)
                    .toBeLessThan(0.03);
            }
        }, 120_000);

    it('cuts a Turn-25 hull\'s RAW turn (k2_t25: 1 a frame, 29.5 deg/s, '
        + 'from q 0.57 to 0.43), its uncharged turn left continuous', () => {
        for (const q of [0.57, 0.5, 0.43]) {
            const slowdown = ionSlowdown({ current: q * 100, max: 100 },
                TURN(25));
            expect(slowdown.turnRate * TURN(25) / ION_TURN_STEP)
                .withContext(`${q}`).toBeCloseTo(1, 9);
        }
        // Uncharged it keeps 2.5 a frame (75 deg/s): wave 51 read 2
        // (as Turn 20), deferred to the next wave; see turnFactor.
        expect(ionSlowdown({ current: 0, max: 100 }, TURN(25)).turnRate)
            .toBe(1);
        expect(ionSlowdown({ current: 0.01, max: 100 }, TURN(25)).turnRate
            * TURN(25) / ION_TURN_STEP).toBeCloseTo(2, 9);
    });
});

describe('ionSlowdown', () => {
    const charge = (current: number, max = 100) => ({ current, max });
    /** The ionized turn in whole degrees a frame on a Turn-`turn` hull. */
    const perFrame = (turn: number, current: number, max = 100) =>
        ionSlowdown(charge(current, max), TURN(turn)).turnRate
        * TURN(turn) / ION_TURN_STEP;

    it('is nothing at no charge, or on a hull with no ion capacity', () => {
        for (const turn of [TURN(10), TURN(30), TURN(200), BASE.turnRate]) {
            expect(ionSlowdown(charge(0), turn)).toEqual(NO_ION_SLOWDOWN);
            expect(ionSlowdown(undefined, turn)).toEqual(NO_ION_SLOWDOWN);
            expect(ionSlowdown(charge(10, 0), turn)).toEqual(NO_ION_SLOWDOWN);
        }
    });

    it('turns floor(Turn / 10 x (1 - q)) whole degrees a frame, matching '
        + 'every stage wave 51 read on every hull', () => {
        // [Turn, q, deg/s read on the reference's 29.15 Hz clock]
        const readings: [number, number, number][] = [
            [10, 0.01, 0], [10, 0.3, 0], [10, 0.45, 0], [10, 1, 0],
            [20, 0.3, 30], [20, 0.45, 31], [20, 0.55, 0], [20, 1, 0],
            [30, 0.3, 58.4], [30, 0.45, 29], [30, 0.55, 29], [30, 1, 0],
            [60, 0.27, 118], [60, 0.4, 87.5], [60, 0.55, 58], [60, 1, 29.2],
            [100, 0.25, 204], [100, 0.35, 176], [100, 0.45, 148],
            [100, 0.55, 118.5], [100, 1, 87.75],
            [200, 0.235, 437], [200, 0.28, 409], [200, 0.32, 378.5],
            [200, 0.38, 350], [200, 0.425, 322], [200, 0.475, 292],
            [200, 0.525, 263.5], [200, 0.56, 236.5], [200, 1, 174.5],
        ];
        for (const [turn, q, read] of readings) {
            const degrees = perFrame(turn, q * 100);
            const context = `Turn ${turn}, q ${q}`;
            expect(Math.abs(degrees - Math.round(degrees)))
                .withContext(context).toBeLessThan(1e-9);
            expect(Math.round(degrees)).withContext(context)
                .toBe(Math.round(read / REFERENCE_STEP));
            // Within a seventh of a step (the hough rates read 1-3 deg/s
            // high on the busiest windows).
            expect(Math.abs(degrees * REFERENCE_STEP - read))
                .withContext(context).toBeLessThan(4);
        }
    });

    it('steps the Turn-30 hull at a third and two thirds (the old "thirds", '
        + 'waves 39-50), Turn 60 at a third and a half, Turn 100 at 0.3, 0.4 '
        + 'and 0.5 (k2_t60 / k2_t100)', () => {
        const levels = (turn: number) => {
            const seen: [number, number][] = [];
            for (let current = 0.25; current <= 100; current += 0.25) {
                const degrees = Math.round(perFrame(turn, current));
                if (!seen.length || seen[seen.length - 1][1] !== degrees) {
                    seen.push([current, degrees]);
                }
            }
            return seen;
        };
        // [first charge (of 100) at the level, degrees a frame]
        expect(levels(30)).toEqual([[0.25, 2], [33.5, 1], [66.75, 0]]);
        expect(levels(60))
            .toEqual([[0.25, 5], [16.75, 4], [33.5, 3], [50.25, 2], [66.75, 1]]);
        expect(levels(100).slice(3, 7))
            .toEqual([[30.25, 6], [40.25, 5], [50.25, 4], [60.25, 3]]);
    });

    it('holds the charge share at ION_CHARGE_HOLD (0.7): a deeper pile cuts '
        + 'neither the turn nor the thrust further', () => {
        expect(ION_CHARGE_HOLD).toBe(0.7);
        for (const turn of [20, 30, 60, 95, 100, 200]) {
            const held = ionSlowdown(charge(70), TURN(turn));
            for (const current of [75, 100, 175, 250]) {
                expect(ionSlowdown(charge(current), TURN(turn)))
                    .withContext(`Turn ${turn}, ${current}`).toEqual(held);
            }
        }
        // The case wave 51 left open: a saturated Turn 95 turns 2 a
        // frame under this floor-at-0.7 GUESS (3 under "strictly below
        // at 2/3").
        expect(perFrame(95, 100)).toBeCloseTo(2, 9);
    });

    it('slides the thrust as 1 - q from the first point to 0.3 at the hold, '
        + 'whatever the hull\'s turn (wave 50 finding 5: the free fit 1.03 - '
        + '1.01 q; wave 51: 0.28 / 0.32 saturated)', () => {
            const accel = (current: number, turn = TURN(30)) =>
                ionSlowdown(charge(current), turn).acceleration;
            expect(ION_FULL_ACCELERATION_FACTOR).toBeCloseTo(0.3, 12);
            expect(accel(0.0001)).toBeCloseTo(1, 4);
            expect(accel(10)).toBeCloseTo(0.9, 9);
            expect(accel(30)).toBeCloseTo(0.7, 9);
            expect(accel(50)).toBeCloseTo(0.5, 9);
            expect(accel(70)).toBeCloseTo(0.3, 9);
            expect(accel(170)).toBeCloseTo(0.3, 9);
            for (const turn of [TURN(10), TURN(200), BASE.turnRate]) {
                expect(accel(50, turn)).toBeCloseTo(0.5, 9);
            }
            // The free fit within 0.05 over the slide.
            for (let current = 5; current <= 65; current += 5) {
                expect(Math.abs(accel(current) - (1.03 - 1.01 * current / 100)))
                    .withContext(`${current}`).toBeLessThan(0.05);
            }
            // No plateau and no step at the tint line.
            let last = Infinity;
            for (let current = 0.5; current <= 69.5; current += 0.5) {
                expect(accel(current)).withContext(`${current}`)
                    .toBeLessThan(last);
                if (last !== Infinity) {
                    expect(last - accel(current)).withContext(`${current}`)
                        .toBeLessThan(0.0051);
                }
                last = accel(current);
            }
            // It scales with IonizeMax.
            expect(ionSlowdown(charge(54, 200), TURN(30)).acceleration)
                .toBeCloseTo(accel(27), 9);
            expect(ionSlowdown(charge(90, 200), TURN(30)).acceleration)
                .toBeCloseTo(accel(45), 9);
        });

    it('leaves a hull with no turn alone', () => {
        expect(ionSlowdown(charge(50), 0).turnRate).toBe(1);
    });
});
