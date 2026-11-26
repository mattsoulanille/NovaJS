import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultShipData, getDefaultShipPhysics, ShipPhysics } from 'novadatainterface/ship_data';
import { MovementPhysicsComponent } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import { DamagedEvent } from './death_plugin.js';
import { completeEntity } from '../spawn/index.js';
import { IonizationComponent } from './health_plugin.js';
import {
    ION_FULL_ACCELERATION_FACTOR, ionizedNow, ionSlowdown, IsIonizedComponent,
    NO_ION_SLOWDOWN,
} from './ionization_plugin.js';
import { makeShip } from './make_ship.js';
import { makeSystem } from '../make_system.js';

/**
 * Maintainer ruling #153 (ionization_plugin.ts): "ionized" is a LEVEL
 * test — the charge is above half of IonizeMax — with no hysteresis. The
 * slowdown is the measured one (reference "Ionization (E6), wave 39"): at
 * a full charge no turn, a third of the acceleration, the top speed kept;
 * linear from the half line (GUESS). What #124 fixed alongside
 * stays pinned here: a hull with no ion capacity is never ionized and
 * never shows a NaN percent.
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

    it('holds above half of IonizeMax, and not at or below it', () => {
        expect(ionizedNow(stat(0))).toBeFalse();
        expect(ionizedNow(stat(49))).toBeFalse();
        expect(ionizedNow(stat(50))).toBeFalse();
        expect(ionizedNow(stat(50.01))).toBeTrue();
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
    it('is not ionized at a charge below half of IonizeMax', async () => {
        const { world, hit, ionized } = await ionWorld();
        hit(0.4 * BASE.ionization);
        steps(world, 2);
        expect(ionized()).toBeFalse();
    });

    it('is ionized once the charge is past half of IonizeMax', async () => {
        const { world, hit, ionized } = await ionWorld();
        hit(0.6 * BASE.ionization);
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

    it('frees the ship the tick its charge decays to half, not when it '
        + 'is gone (no hysteresis)', async () => {
            const { world, hit, ionized, charge } = await ionWorld();
            hit(BASE.ionization);
            world.step();
            expect(ionized()).toBeTrue();
            const half = BASE.ionization / 2;
            // Above half, every tick of the way: still ionized.
            let droppedEarly = false;
            while (charge().current > half) {
                droppedEarly ||= !ionized();
                world.step();
            }
            expect(droppedEarly).toBeFalse();
            // At or below half: free (one tick for the state to follow),
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

    it('frees the movement again once the charge falls to half',
        async () => {
            const { world, ship, hit, charge } = await ionWorld();
            hit(BASE.ionization);
            while (charge().current > BASE.ionization / 2) {
                world.step();
            }
            steps(world, 2);
            const physics = ship.components.get(MovementPhysicsComponent)!;
            expect(physics.turnRate).toBeCloseTo(BASE.turnRate, 6);
            expect(physics.acceleration)
                .toBeCloseTo(BASE.acceleration, 6);
        });
});

describe('ionSlowdown', () => {
    const charge = (current: number, max = 100) => ({ current, max });

    it('is nothing for a ship that is not ionized', () => {
        expect(ionSlowdown(charge(100), false)).toEqual(NO_ION_SLOWDOWN);
        expect(ionSlowdown(charge(100), undefined)).toEqual(NO_ION_SLOWDOWN);
        expect(ionSlowdown(undefined, true)).toEqual(NO_ION_SLOWDOWN);
        expect(ionSlowdown(charge(10, 0), true)).toEqual(NO_ION_SLOWDOWN);
    });

    it('is the measured cut at IonizeMax and past it', () => {
        for (const current of [100, 250]) {
            expect(ionSlowdown(charge(current), true)).toEqual({
                maxVelocity: 1,
                acceleration: ION_FULL_ACCELERATION_FACTOR,
                turnRate: 0,
            });
        }
    });

    it('scales linearly from the half line (GUESS)', () => {
        const at = (current: number) => ionSlowdown(charge(current), true);
        expect(at(50)).toEqual(NO_ION_SLOWDOWN);
        expect(at(75).turnRate).toBeCloseTo(0.5, 9);
        expect(at(75).acceleration).toBeCloseTo(2 / 3, 9);
        expect(at(75).maxVelocity).toBe(1);
        expect(at(90).turnRate).toBeCloseTo(0.2, 9);
    });
});
