import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultOutfitData } from 'novadatainterface/outfit_data';
import { getDefaultShipData, getDefaultShipPhysics, ShipData } from 'novadatainterface/ship_data';
import {
    getDefaultProjectileWeaponData, ProjectileWeaponData, SubmunitionType,
} from 'novadatainterface/weapon_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import { completeEntity } from './entity_data_loader.js';
import { WeaponEntries } from './fire_weapon_plugin.js';
import { makeShip } from './make_ship.js';
import { makeSystem } from './make_system.js';
import { ProjectileComponent } from './projectile_data.js';

/**
 * wëap SubLimit (EVN Bible ~:3280-3284): "If you have defined a
 * recursively-submunitioning weapon (i.e. one which splits into more
 * copies of itself) this field will allow you to limit the number of
 * recursive splits that happen. This field is ignored if the weapon is
 * not recursively submunitioning."
 *
 * The old gate compared every shot's generation against the limit with
 * `>`, so a non-recursive weapon whose SubLimit was left at -1 (arpia's
 * "Explosion") never submunitioned at all, and a recursive weapon with a
 * limit of L split L+1 times.
 */

const SHIP_ID = 'test:ship';
const SHIP_UUID = 'ship';
const PARENT = 'test:parent';
const CHILD = 'test:child';
const RECURSIVE = 'test:recursive';

const SHOT_LIFE_MS = 100;

function weapon(id: string, subs: SubmunitionType[] = []): ProjectileWeaponData {
    return {
        ...getDefaultProjectileWeaponData(),
        id,
        reload: 1000,
        shotDuration: SHOT_LIFE_MS,
        guidance: 'unguided',
        exitType: 'center',
        submunitions: subs,
    };
}

function sub(id: string, count: number, limit: number): SubmunitionType {
    // A negative theta is a starburst (evenly spaced), which keeps the
    // spawn deterministic without a PRNG draw per child.
    return { id, count, theta: -0.3, limit, fireAtNearest: false, subIfExpire: true };
}

async function makeTestWorld(weapons: ProjectileWeaponData[]) {
    const gameData = new MockGameData();
    for (const data of weapons) {
        gameData.data.Weapon.map.set(data.id, data);
    }
    gameData.data.Outfit.map.set('test:launcher', {
        ...getDefaultOutfitData(),
        id: 'test:launcher',
        weapons: Object.fromEntries(weapons.map(w => [w.id, 1])),
    });
    const shipData: ShipData = {
        ...getDefaultShipData(),
        id: SHIP_ID,
        outfits: { 'test:launcher': 1 },
        physics: { ...getDefaultShipPhysics() },
    };
    gameData.data.Ship.map.set(SHIP_ID, shipData);

    const world = await makeSystem('test:system', gameData);
    const ship = makeShip(shipData);
    await completeEntity(world, ship);
    ship.components.set(MovementStateComponent, {
        position: new Position(0, 0),
        velocity: new Vector(0, 0),
        rotation: new Angle(0),
        accelerating: 0,
        turning: 0,
        turnBack: false,
    });
    world.entities.set(SHIP_UUID, ship);
    await stepWorld(world, 2);

    const entries = world.resources.get(WeaponEntries)!;
    for (const data of weapons) {
        await entries.get(data.id);
    }
    return { world, entries };
}

async function stepWorld(world: World, steps: number) {
    for (let i = 0; i < steps; i++) {
        world.step();
        await new Promise(resolve => setImmediate(resolve));
    }
}

/** Every projectile of weapon `id` ever seen over `steps` ticks. */
async function spawnedOver(world: World, id: string, steps: number) {
    const seen = new Set<string>();
    for (let i = 0; i < steps; i++) {
        await stepWorld(world, 1);
        for (const [uuid, entity] of world.entities) {
            if (entity.components.get(ProjectileComponent)?.id === id) {
                seen.add(uuid);
            }
        }
    }
    return seen.size;
}

describe('submunition SubLimit (#51)', () => {
    it('ignores the limit for a weapon that is not recursive (-1 = unused)',
        async () => {
            const { world, entries } = await makeTestWorld([
                weapon(PARENT, [sub(CHILD, 3, -1)]),
                weapon(CHILD),
            ]);
            expect(entries.getCached(PARENT)!.fireFromEntity(SHIP_UUID, false))
                .toBeDefined();
            expect(await spawnedOver(world, CHILD, 20)).toEqual(3);
        });

    it('ignores a positive limit for a non-recursive weapon too', async () => {
        // extra-outfits "Blockade Mine": 5 subs, limit 5, not recursive.
        const { world, entries } = await makeTestWorld([
            weapon(PARENT, [sub(CHILD, 5, 5)]),
            weapon(CHILD),
        ]);
        entries.getCached(PARENT)!.fireFromEntity(SHIP_UUID, false);
        expect(await spawnedOver(world, CHILD, 20)).toEqual(5);
    });

    it('allows exactly SubLimit recursive splits', async () => {
        // Cloud Bomb shape: splits in two, limit 2. One shot, then two,
        // then four; the four do not split again: 7 in all (15 with the
        // extra generation the old gate let through).
        const { world, entries } = await makeTestWorld([
            weapon(RECURSIVE, [sub(RECURSIVE, 2, 2)]),
        ]);
        entries.getCached(RECURSIVE)!.fireFromEntity(SHIP_UUID, false);
        expect(await spawnedOver(world, RECURSIVE, 60)).toEqual(7);
    });

    it('makes no recursive splits with a limit of 0', async () => {
        const { world, entries } = await makeTestWorld([
            weapon(RECURSIVE, [sub(RECURSIVE, 2, 0)]),
        ]);
        entries.getCached(RECURSIVE)!.fireFromEntity(SHIP_UUID, false);
        expect(await spawnedOver(world, RECURSIVE, 30)).toEqual(1);
    });

    it('makes no recursive splits with a limit of -1 either', async () => {
        const { world, entries } = await makeTestWorld([
            weapon(RECURSIVE, [sub(RECURSIVE, 2, -1)]),
        ]);
        entries.getCached(RECURSIVE)!.fireFromEntity(SHIP_UUID, false);
        expect(await spawnedOver(world, RECURSIVE, 30)).toEqual(1);
    });
});
