import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultShipData, getDefaultShipPhysics, ShipPhysics } from 'novadatainterface/ship_data';
import { MovementPhysicsComponent } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import { DamagedEvent } from './death_plugin.js';
import { completeEntity } from './entity_data_loader.js';
import { IonizationComponent } from './health_plugin.js';
import { ION_FACTOR, ionizedNow, IsIonizedComponent } from './ionization_plugin.js';
import { makeShip } from './make_ship.js';
import { makeSystem } from './make_system.js';

/**
 * Maintainer ruling #153 (ionization_plugin.ts): "ionized" is a LEVEL
 * test — the charge is above half of IonizeMax — with no hysteresis, and
 * the slowdown factor is 0.6. Both are the pre-PR-#124 values, restored;
 * the maintainer will playtest from there. What #124 fixed alongside
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

    it('is ionized at IonizeMax, and the stat clamps the charge there',
        async () => {
            const { world, hit, ionized, charge } = await ionWorld();
            hit(BASE.ionization);
            steps(world, 2);
            expect(ionized()).toBeTrue();
            expect(charge().current).toBeLessThanOrEqual(BASE.ionization);
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

    it('slows an ionized ship by ION_FACTOR', async () => {
        const { world, ship, hit } = await ionWorld();
        hit(BASE.ionization);
        steps(world, 2);
        const physics = ship.components.get(MovementPhysicsComponent)!;
        expect(physics.maxVelocity).toBeCloseTo(BASE.speed * ION_FACTOR, 6);
        expect(physics.acceleration)
            .toBeCloseTo(BASE.acceleration * ION_FACTOR, 6);
        expect(physics.turnRate).toBeCloseTo(BASE.turnRate * ION_FACTOR, 6);
    });

    it('slows by the pre-#124 factor, 0.6 (ruling #153; maintainer will '
        + 'playtest)', () => {
            expect(ION_FACTOR).toBe(0.6);
        });
});
