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
import {
    completeEntity, loadWeaponsGameData,
} from '../spawn/index.js';
import { WeaponEntries } from './fire_weapon_plugin.js';
import { makeShip } from '../ship/index.js';
import { makeSystem } from '../make_system.js';
import { ProjectileComponent } from '../core/index.js';
import { MAX_SHOTS } from './shot_cap.js';

/**
 * The original's shot cap (shot_cap.ts; reference "The shot cap, wave
 * 58"): at most MAX_SHOTS (128) projectiles alive in a system, on screen
 * or not, and a full table refuses the NEW shot.
 */

const SHIP_ID = 'test:ship';
const SHIP_UUID = 'ship';
const PARENT = 'test:parent';
const CHILD = 'test:child';
const GUN = 'test:gun';

const SHOT_LIFE_MS = 100;
const LONG_LIFE_MS = 2000;

function weapon(id: string, subs: SubmunitionType[] = [],
    life = SHOT_LIFE_MS): ProjectileWeaponData {
    return {
        ...getDefaultProjectileWeaponData(),
        id,
        reload: 1000,
        shotDuration: life,
        guidance: 'unguided',
        exitType: 'center',
        submunitions: subs,
    };
}

function sub(id: string, count: number): SubmunitionType {
    // A negative theta is a starburst (evenly spaced): no PRNG draws.
    return { id, count, theta: -0.03, limit: -1, fireAtNearest: false, subIfExpire: true };
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
    await loadWeaponsGameData(world, weapons.map(data => data.id));
    const entries = world.resources.get(WeaponEntries)!;
    return { world, entries };
}

async function stepWorld(world: World, steps: number) {
    for (let i = 0; i < steps; i++) {
        world.step();
        await new Promise(resolve => setImmediate(resolve));
    }
}

/** Projectiles alive in `world` now. */
function liveShots(world: World) {
    let n = 0;
    for (const entity of world.entities.values()) {
        if (entity.components.has(ProjectileComponent)) {
            n++;
        }
    }
    return n;
}

describe('shot cap (Max Shots On Screen 128)', () => {
    it('is the Bible\'s 128', () => {
        expect(MAX_SHOTS).toEqual(128);
    });

    it('caps a burst that would overflow it', async () => {
        // 200 long-lived children from one parent: the parent still holds
        // its slot while they spawn, so 127 of them fit.
        const { world, entries } = await makeTestWorld([
            weapon(PARENT, [sub(CHILD, 200)]),
            weapon(CHILD, [], LONG_LIFE_MS),
        ]);
        entries.getCached(PARENT)!.fireFromEntity(SHIP_UUID, false);
        let peak = 0;
        const seen = new Set<string>();
        for (let i = 0; i < 30; i++) {
            await stepWorld(world, 1);
            peak = Math.max(peak, liveShots(world));
            for (const [uuid, entity] of world.entities) {
                if (entity.components.get(ProjectileComponent)?.id === CHILD) {
                    seen.add(uuid);
                }
            }
        }
        // The parent is gone by the end of the tick that spawned them.
        expect(peak).toEqual(MAX_SHOTS - 1);
        expect(seen.size).toEqual(MAX_SHOTS - 1);
    });

    it('refuses a new shot while full, and takes it once a slot frees',
        async () => {
            const { world, entries } = await makeTestWorld([
                weapon(PARENT, [sub(CHILD, 200)]),
                weapon(CHILD, [], LONG_LIFE_MS),
                weapon(GUN, [], LONG_LIFE_MS),
            ]);
            entries.getCached(PARENT)!.fireFromEntity(SHIP_UUID, false);
            await stepWorld(world, 20);
            expect(liveShots(world)).toEqual(MAX_SHOTS - 1);
            // One slot left: the first gun shot fits, the second does not.
            const gun = entries.getCached(GUN)!;
            expect(gun.fireFromEntity(SHIP_UUID, false)).toBeDefined();
            expect(gun.fireFromEntity(SHIP_UUID, false)).toBeUndefined();
            expect(liveShots(world)).toEqual(MAX_SHOTS);
            // Everything expires (2 s): the table empties and shots fly.
            await stepWorld(world, 150);
            expect(liveShots(world)).toEqual(0);
            expect(gun.fireFromEntity(SHIP_UUID, false)).toBeDefined();
        });
});
