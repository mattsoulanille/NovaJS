import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultOutfitData, OutfitData } from 'novadatainterface/outfit_data';
import { getDefaultShipData, getDefaultShipPhysics, ShipData } from 'novadatainterface/ship_data';
import { AmmoType, getDefaultProjectileWeaponData, ProjectileWeaponData } from 'novadatainterface/weapon_data';
import { Entity } from 'nova_ecs/entity';
import { MovementPhysicsComponent, MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import { AFTERBURNER_FACTOR } from '../travel/afterburner_plugin.js';
import { completeEntity } from '../spawn/entity_data_loader.js';
import { AUTO_REFUEL_PER_SECOND, FuelComponent } from './health_plugin.js';
import { makeShip } from './make_ship.js';
import { makeSystem, SIMULATION_STEP_MS } from '../make_system.js';
import { OutfitsStateComponent } from './outfit_plugin.js';
import { ProjectileComponent } from '../core/projectile_data.js';
import { ShipControlStateComponent } from '../player/ship_control.js';
import { WeaponsStateComponent } from './weapons_state.js';

const SHIP_ID = 'test:ship';
const WEAPON_ID = 'test:weapon';
const LAUNCHER_ID = 'test:launcher';
// Two ammo outfits for the same weapon, like Nova's regular and
// fire-while-cloaked Polaron Multi-Torpedoes.
const AMMO_A_ID = 'test:ammoA';
const AMMO_B_ID = 'test:ammoB';

/**
 * A system world with a single ship whose one weapon has the given ammo
 * type, ready to fire.
 */
async function makeTestWorld({ ammoType, ammoCounts = {}, energy = 200,
    energyRecharge = 0, afterburner = 0, autoRefuel = false }: {
        ammoType: AmmoType,
        ammoCounts?: { [id: string]: number },
        energy?: number,
        energyRecharge?: number,
        afterburner?: number,
        autoRefuel?: boolean,
    }) {
    const gameData = new MockGameData();

    const weapon: ProjectileWeaponData = {
        ...getDefaultProjectileWeaponData(),
        id: WEAPON_ID,
        // The shortest reload there is: WeaponsSystem floors it at one
        // original 30 fps frame, so a held trigger fires every SECOND
        // 60 Hz step (steps 1, 3, 5, ...).
        reload: 1,
        // Projectiles never expire during a test.
        shotDuration: 1e9,
        fireGroup: 'primary',
        guidance: 'unguided',
        ammoType,
    };
    gameData.data.Weapon.map.set(WEAPON_ID, weapon);

    const launcher: OutfitData = {
        ...getDefaultOutfitData(),
        id: LAUNCHER_ID,
        weapons: { [WEAPON_ID]: 1 },
    };
    gameData.data.Outfit.map.set(LAUNCHER_ID, launcher);

    // An auto-refueller outfit (ModType 19): its physics.autoRefuel ORs the
    // capability onto the ship via applyOutfitPhysics.
    const AUTO_REFUEL_ID = 'test:autorefuel';
    gameData.data.Outfit.map.set(AUTO_REFUEL_ID, {
        ...getDefaultOutfitData(),
        id: AUTO_REFUEL_ID,
        autoRefuel: true,
        physics: { freeMass: 0, autoRefuel: true },
    });

    for (const ammoId of [AMMO_A_ID, AMMO_B_ID]) {
        gameData.data.Outfit.map.set(ammoId, {
            ...getDefaultOutfitData(),
            id: ammoId,
            ammoFor: WEAPON_ID,
        });
    }

    const shipData: ShipData = {
        ...getDefaultShipData(),
        id: SHIP_ID,
        outfits: {
            [LAUNCHER_ID]: 1, ...ammoCounts,
            ...(autoRefuel ? { [AUTO_REFUEL_ID]: 1 } : {}),
        },
        physics: {
            ...getDefaultShipPhysics(),
            energy,
            energyRecharge,
            afterburner,
        },
    };
    gameData.data.Ship.map.set(SHIP_ID, shipData);

    const world = await makeSystem('test:system', gameData);
    const ship = makeShip(shipData);
    await completeEntity(world, ship);
    world.entities.set('test ship uuid', ship);

    // Let the provide systems attach fuel, weapon state, etc.
    await stepWorld(world, 2);

    return { world, ship };
}

async function stepWorld(world: World, steps: number) {
    for (let i = 0; i < steps; i++) {
        world.step();
        // Let async providers resolve.
        await new Promise(resolve => setImmediate(resolve));
    }
}

function setFiring(ship: Entity, firing: boolean) {
    const weaponsState = ship.components.get(WeaponsStateComponent)!;
    weaponsState.get(WEAPON_ID)!.firing = firing;
}

function countProjectiles(world: World): number {
    let count = 0;
    for (const [, entity] of world.entities) {
        if (entity.components.has(ProjectileComponent)) {
            count++;
        }
    }
    return count;
}

describe('weapon ammo', () => {
    it('decrements outfit ammo when firing', async () => {
        const { world, ship } = await makeTestWorld({
            ammoType: ['weapon', WEAPON_ID],
            ammoCounts: { [AMMO_A_ID]: 3 },
        });
        setFiring(ship, true);

        // Two shots: steps 1 and 3.
        await stepWorld(world, 4);
        const outfits = ship.components.get(OutfitsStateComponent)!;
        expect(outfits.get(AMMO_A_ID)!.count).toEqual(1);
        expect(countProjectiles(world)).toEqual(2);
    });

    it('stops firing when out of ammo', async () => {
        const { world, ship } = await makeTestWorld({
            ammoType: ['weapon', WEAPON_ID],
            ammoCounts: { [AMMO_A_ID]: 3 },
        });
        setFiring(ship, true);

        await stepWorld(world, 20);
        const outfits = ship.components.get(OutfitsStateComponent)!;
        expect(outfits.get(AMMO_A_ID)!.count).toEqual(0);
        expect(countProjectiles(world)).toEqual(3);
    });

    it('never fires a weapon that has no ammo outfit', async () => {
        const { world, ship } = await makeTestWorld({
            ammoType: ['weapon', WEAPON_ID],
        });
        setFiring(ship, true);

        await stepWorld(world, 10);
        expect(countProjectiles(world)).toEqual(0);
    });

    it('consumes ammo outfits in a deterministic order', async () => {
        const { world, ship } = await makeTestWorld({
            ammoType: ['weapon', WEAPON_ID],
            ammoCounts: { [AMMO_B_ID]: 2, [AMMO_A_ID]: 2 },
        });
        setFiring(ship, true);

        // Three shots: steps 1, 3 and 5.
        await stepWorld(world, 5);
        const outfits = ship.components.get(OutfitsStateComponent)!;
        // The lowest outfit id drains first.
        expect(outfits.get(AMMO_A_ID)!.count).toEqual(0);
        expect(outfits.get(AMMO_B_ID)!.count).toEqual(1);

        await stepWorld(world, 20);
        expect(outfits.get(AMMO_B_ID)!.count).toEqual(0);
        expect(countProjectiles(world)).toEqual(4);
    });
});

describe('weapon fuel cost', () => {
    it('drains fuel per shot and stops firing when dry', async () => {
        const { world, ship } = await makeTestWorld({
            ammoType: ['energy', 30],
            energy: 90,
        });
        setFiring(ship, true);

        await stepWorld(world, 20);
        const fuel = ship.components.get(FuelComponent)!;
        expect(fuel.current).toEqual(0);
        expect(countProjectiles(world)).toEqual(3);
    });

    it('cannot fire with less fuel than a shot costs', async () => {
        const { world, ship } = await makeTestWorld({
            ammoType: ['energy', 30],
            energy: 90,
        });
        const fuel = ship.components.get(FuelComponent)!;
        fuel.current = 29;
        setFiring(ship, true);

        await stepWorld(world, 10);
        expect(countProjectiles(world)).toEqual(0);
        expect(fuel.current).toEqual(29);
    });
});

describe('fuel regeneration', () => {
    it('recharges fuel at the ship physics rate', async () => {
        const { world, ship } = await makeTestWorld({
            ammoType: 'unlimited',
            energy: 100,
            energyRecharge: 10,
        });
        const fuel = ship.components.get(FuelComponent)!;
        fuel.current = 0;

        await stepWorld(world, 60);
        expect(fuel.current).toBeCloseTo(10 * 60 * SIMULATION_STEP_MS / 1000, 0);
    });

    it('does not recharge fuel past its capacity', async () => {
        const { world, ship } = await makeTestWorld({
            ammoType: 'unlimited',
            energy: 100,
            energyRecharge: 1000,
        });
        await stepWorld(world, 10);
        const fuel = ship.components.get(FuelComponent)!;
        expect(fuel.current).toEqual(100);
    });

    it('an auto-refueller outfit trickles fuel back (ModType 19)', async () => {
        // No fuel-scoop recharge; the only regeneration is the auto-refueller.
        const { world, ship } = await makeTestWorld({
            ammoType: 'unlimited',
            energy: 100,
            energyRecharge: 0,
            autoRefuel: true,
        });
        const fuel = ship.components.get(FuelComponent)!;
        fuel.current = 0;

        await stepWorld(world, 60);
        // AUTO_REFUEL_PER_SECOND (2.5) units/second for 60 sim ticks.
        expect(fuel.current).toBeCloseTo(
            AUTO_REFUEL_PER_SECOND * 60 * SIMULATION_STEP_MS / 1000, 0);
        expect(fuel.current).toBeGreaterThan(0);
    });

    it('a ship without an auto-refueller does not regenerate fuel', async () => {
        const { world, ship } = await makeTestWorld({
            ammoType: 'unlimited',
            energy: 100,
            energyRecharge: 0,
        });
        const fuel = ship.components.get(FuelComponent)!;
        fuel.current = 10;

        await stepWorld(world, 60);
        expect(fuel.current).toEqual(10);
    });
});

describe('afterburner', () => {
    async function makeAfterburnerWorld() {
        const made = await makeTestWorld({
            ammoType: 'unlimited',
            energy: 100,
            afterburner: 30,
        });
        made.ship.components.set(ShipControlStateComponent, new Map());
        await stepWorld(made.world, 1);
        return made;
    }

    it('boosts speed and burns fuel while engaged', async () => {
        const { world, ship } = await makeAfterburnerWorld();
        const movementPhysics = ship.components.get(MovementPhysicsComponent)!;
        const baseSpeed = getDefaultShipPhysics().speed;
        expect(movementPhysics.maxVelocity).toEqual(baseSpeed);

        const controlState = ship.components.get(ShipControlStateComponent)!;
        controlState.set('afterburner', true);
        await stepWorld(world, 60);

        expect(movementPhysics.maxVelocity)
            .toEqual(baseSpeed * AFTERBURNER_FACTOR);
        const movementState = ship.components.get(MovementStateComponent)!;
        expect(movementState.accelerating).toEqual(1);
        const fuel = ship.components.get(FuelComponent)!;
        // 30 units/sec for ~1 second.
        expect(fuel.current).toBeCloseTo(100 - 30 * 60 * SIMULATION_STEP_MS / 1000, 0);
    });

    it('cuts out when fuel runs dry', async () => {
        const { world, ship } = await makeAfterburnerWorld();
        const controlState = ship.components.get(ShipControlStateComponent)!;
        controlState.set('afterburner', true);
        await stepWorld(world, 1);

        const movementPhysics = ship.components.get(MovementPhysicsComponent)!;
        const baseSpeed = getDefaultShipPhysics().speed;
        expect(movementPhysics.maxVelocity)
            .toEqual(baseSpeed * AFTERBURNER_FACTOR);

        const fuel = ship.components.get(FuelComponent)!;
        fuel.current = 0;
        await stepWorld(world, 1);
        expect(movementPhysics.maxVelocity).toEqual(baseSpeed);
    });
});
