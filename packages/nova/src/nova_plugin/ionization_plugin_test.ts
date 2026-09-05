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
 * EVN Bible: IonizeMax is "the amount of ion charge at which a ship of
 * this type will be considered 'fully ionized'", and "when a ship is
 * ionized it becomes nearly immobilized until the ionization charge
 * dissipates". These specs pin that reading (ionization_plugin.ts):
 * ionized at IonizeMax, not before; ionized until the charge is gone,
 * not until it drops below some level; nearly immobilized meanwhile;
 * and a hull with no ion capacity is never ionized.
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

describe('ionizedNow (the state rule)', () => {
    const stat = (current: number, max = 100) => ({ current, max, min: 0 });

    it('begins only at IonizeMax', () => {
        expect(ionizedNow(stat(51), false)).toBeFalse();
        expect(ionizedNow(stat(99.9), false)).toBeFalse();
        expect(ionizedNow(stat(100), false)).toBeTrue();
        expect(ionizedNow(stat(140), false)).toBeTrue();
    });

    it('lasts until the charge has dissipated', () => {
        expect(ionizedNow(stat(99), true)).toBeTrue();
        expect(ionizedNow(stat(1), true)).toBeTrue();
        expect(ionizedNow(stat(0), true)).toBeFalse();
    });

    it('never holds for a hull with no ion capacity', () => {
        expect(ionizedNow(stat(0, 0), false)).toBeFalse();
        expect(ionizedNow(stat(20, 0), false)).toBeFalse();
        expect(ionizedNow(stat(20, 0), true)).toBeFalse();
    });
});

describe('ionization in a live world', () => {
    it('is not ionized below IonizeMax, even past half of it', async () => {
        const { world, hit, ionized } = await ionWorld();
        hit(60);
        steps(world, 2);
        expect(ionized()).toBeFalse();
    });

    it('is fully ionized once the charge reaches IonizeMax', async () => {
        const { world, hit, ionized, charge } = await ionWorld();
        hit(BASE.ionization);
        steps(world, 2);
        expect(ionized()).toBeTrue();
        // The stat clamps the charge to its capacity.
        expect(charge().current).toBeLessThanOrEqual(BASE.ionization);
    });

    it('stays ionized until the charge has fully dissipated', async () => {
        const { world, hit, ionized, charge } = await ionWorld();
        hit(BASE.ionization);
        world.step();
        expect(ionized()).toBeTrue();
        // Well under half capacity: still ionized.
        while (charge().current > 0.3 * BASE.ionization) {
            world.step();
        }
        expect(ionized()).toBeTrue();
        // Down to the last of it: still ionized, every tick of the way.
        let droppedEarly = false;
        while (charge().current > 0) {
            droppedEarly ||= !ionized();
            world.step();
        }
        expect(droppedEarly).toBeFalse();
        // Gone: the ship is free again (one tick for the state to follow).
        world.step();
        expect(charge().current).toBe(0);
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

    it('nearly immobilizes an ionized ship', async () => {
        const { world, ship, hit } = await ionWorld();
        hit(BASE.ionization);
        steps(world, 2);
        const physics = ship.components.get(MovementPhysicsComponent)!;
        expect(physics.maxVelocity).toBeCloseTo(BASE.speed * ION_FACTOR, 6);
        expect(physics.acceleration)
            .toBeCloseTo(BASE.acceleration * ION_FACTOR, 6);
        expect(physics.turnRate).toBeCloseTo(BASE.turnRate * ION_FACTOR, 6);
        // "Nearly immobilized" — a crawl, not a mild slowdown.
        expect(ION_FACTOR).toBeLessThanOrEqual(0.25);
        expect(ION_FACTOR).toBeGreaterThan(0);
    });
});
