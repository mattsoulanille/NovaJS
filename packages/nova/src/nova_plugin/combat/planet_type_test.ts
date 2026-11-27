import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import {
    getDefaultProjectileWeaponData, ProjectileWeaponData,
} from 'novadatainterface/weapon_data';
import { RunQuery } from 'nova_ecs/arg_types';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { completeEntity } from '../spawn/index.js';
import { makeShip, ShieldComponent } from '../ship/index.js';
import { makeSystem } from '../make_system.js';
import { WeaponConstructors } from './fire_weapon_plugin.js';
import { CollisionHitterComponent } from '../core/index.js';

/**
 * Reference "Planet-type weapons against ships (E4), wave 41": a damaging
 * planet-type turret (wëap Flags2 0x0400) did nothing to a plain ship and
 * took a planet-type ship (shïp Flags 0x0400) to "Shields Down"; a plain
 * turret did nothing to the planet-type ship. The two kinds hit only each
 * other.
 */
const PLAIN = 'test:plain';
const PLANET = 'test:planetShip';

async function shoot(planetWeapon: boolean, planetShip: boolean) {
    const gameData = new MockGameData();
    gameData.data.Ship.map.set(PLAIN, { ...getDefaultShipData(), id: PLAIN });
    gameData.data.Ship.map.set(PLANET, {
        ...getDefaultShipData(), id: PLANET, vulnerableTo: ['planetType'],
    });
    const world = await makeSystem('test:system', gameData, undefined,
        { npcs: false });
    const target = makeShip(gameData.data.Ship.map.get(
        planetShip ? PLANET : PLAIN)!);
    target.components.set(MovementStateComponent, {
        accelerating: 0, position: new Position(0, -100),
        rotation: new Angle(0), turnBack: false, turning: 0,
        velocity: new Vector(0, 0),
    });
    await completeEntity(world, target);
    world.entities.set('target', target);
    world.step();
    const before = target.components.get(ShieldComponent)!.current;

    const data: ProjectileWeaponData = {
        ...getDefaultProjectileWeaponData(),
        id: 'test:turret',
        planetType: planetWeapon,
        shotDuration: 2000,
        damage: {
            ...getDefaultProjectileWeaponData().damage, shield: 30, armor: 30,
        },
        physics: {
            ...getDefaultProjectileWeaponData().physics, speed: 600,
        },
    };
    const construct = world.resources.get(WeaponConstructors)!
        .get('ProjectileWeaponData')!;
    const entry = new construct(data, world.resources.get(RunQuery)!);
    // Straight at the target (angle 0 points along -y).
    const shot = entry.fire(new Position(0, 0), new Angle(0), 'shooter',
        'target', 'shooter')!;
    const hitTypes = [...shot.components.get(CollisionHitterComponent)!
        .hitTypes];
    for (let i = 0; i < 40; i++) {
        world.step();
    }
    return {
        hitTypes,
        lost: before - target.components.get(ShieldComponent)!.current,
    };
}

describe('planet-type weapons and ships (E4 wave 41)', () => {
    it('a planet-type shot hits a planet-type ship', async () => {
        const { hitTypes, lost } = await shoot(true, true);
        expect(hitTypes).toEqual(['planetType']);
        expect(lost).toBeGreaterThan(0);
    });

    it('a planet-type shot passes through a plain ship', async () => {
        expect((await shoot(true, false)).lost).toBe(0);
    });

    it('a plain shot passes through a planet-type ship', async () => {
        expect((await shoot(false, true)).lost).toBe(0);
    });

    it('a plain shot still hits a plain ship (control)', async () => {
        expect((await shoot(false, false)).lost).toBeGreaterThan(0);
    });
});
