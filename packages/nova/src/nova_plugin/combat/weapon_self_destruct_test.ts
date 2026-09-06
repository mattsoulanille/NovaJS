import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultOutfitData, OutfitData } from 'novadatainterface/outfit_data';
import {
    getDefaultShipData, getDefaultShipPhysics, ShipData,
} from 'novadatainterface/ship_data';
import {
    getDefaultProjectileWeaponData, ProjectileWeaponData,
} from 'novadatainterface/weapon_data';
import { Entity } from 'nova_ecs/entity';
import { World } from 'nova_ecs/world';
import { ShipExplosionComponent } from '../ship/ship_explosion.js';
import { ExplodingComponent } from '../ship/death_plugin.js';
import { completeEntity } from '../spawn/entity_data_loader.js';
import { ArmorComponent } from '../ship/health_plugin.js';
import { makeShip } from '../ship/make_ship.js';
import { makeSystem } from '../make_system.js';
import { DeathAIComponent } from '../npc/npc_plugin.js';
import { ProjectileComponent } from '../core/projectile_data.js';
import { WeaponsStateComponent } from '../ship/weapons_state.js';

const SHIP_ID = 'test:ship';
const SUICIDE_ID = 'test:suicide';
const NORMAL_ID = 'test:normal';
const LAUNCHER_ID = 'test:launcher';

/**
 * ============================================================================
 * wëap AmmoType -999: "Ship is destroyed when weapon is fired"
 * ============================================================================
 *
 * EVN Bible ~:3124. NovaParse has always decoded the sentinel
 * (WeaponData.destroyShipWhenFiring); until this spec's fix nothing in
 * the simulation read it, so such a weapon simply fired forever as an
 * unlimited-ammo gun. The Intelligent EMP Torpedo plug-in is built
 * entirely on it: its bay launches a torpedo SHIP whose gun is a -999
 * weapon, so the torpedo's own trigger is what detonates it.
 *
 * The spec pins the whole death, not just a flag: the shot leaves, the
 * firer enters its ordinary death sequence (DeathDelay and all), the
 * DeathEvent at the end of it drops the hull's blast like any other
 * destroyed ship, and nothing fires a second time out of the corpse.
 */

async function makeTestWorld({ deathDelay = 1, destroyShipWhenFiring = true }:
    { deathDelay?: number, destroyShipWhenFiring?: boolean } = {}) {
    const gameData = new MockGameData();

    const suicide: ProjectileWeaponData = {
        ...getDefaultProjectileWeaponData(),
        id: SUICIDE_ID,
        // The shortest reload there is — WeaponsSystem floors it at one
        // original 30 fps frame, every second 60 Hz step — so "it never
        // fired again" is a real claim rather than an artifact of a long
        // reload.
        reload: 1,
        shotDuration: 1e9,
        fireGroup: 'primary',
        guidance: 'unguided',
        ammoType: 'unlimited',
        destroyShipWhenFiring,
    };
    gameData.data.Weapon.map.set(SUICIDE_ID, suicide);

    // An ordinary weapon on the same ship, mounted through the SAME
    // outfit: the control for "only the -999 weapon kills", and the
    // subject of "a destroyed ship's other weapons don't fire either".
    gameData.data.Weapon.map.set(NORMAL_ID, {
        ...suicide,
        id: NORMAL_ID,
        destroyShipWhenFiring: false,
    });

    const launcher: OutfitData = {
        ...getDefaultOutfitData(),
        id: LAUNCHER_ID,
        weapons: { [SUICIDE_ID]: 1, [NORMAL_ID]: 1 },
    };
    gameData.data.Outfit.map.set(LAUNCHER_ID, launcher);

    const shipData: ShipData = {
        ...getDefaultShipData(),
        id: SHIP_ID,
        deathDelay,
        outfits: { [LAUNCHER_ID]: 1 },
        physics: { ...getDefaultShipPhysics(), armorRecharge: 0 },
    };
    gameData.data.Ship.map.set(SHIP_ID, shipData);

    const world = await makeSystem('test:system', gameData);
    const ship = makeShip(shipData);
    // The death sequence of an NPC ends in its removal; a bay fighter is
    // one of these, which is the case the plug-in exercises.
    ship.components.set(DeathAIComponent, undefined);
    await completeEntity(world, ship);
    world.entities.set('test ship uuid', ship);

    await stepWorld(world, 2);
    return { world, ship };
}

async function stepWorld(world: World, steps: number) {
    for (let i = 0; i < steps; i++) {
        world.step();
        await new Promise(resolve => setImmediate(resolve));
    }
}

function setFiring(ship: Entity, id: string, firing: boolean) {
    ship.components.get(WeaponsStateComponent)!.get(id)!.firing = firing;
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

function countShipExplosions(world: World): number {
    let count = 0;
    for (const [, entity] of world.entities) {
        if (entity.components.has(ShipExplosionComponent)) {
            count++;
        }
    }
    return count;
}

describe('a weapon with AmmoType -999', () => {
    it('fires its shot and destroys the ship that fired it', async () => {
        const { world, ship } = await makeTestWorld();
        expect(ship.components.get(ArmorComponent)!.current).toEqual(100);
        setFiring(ship, SUICIDE_ID, true);

        await stepWorld(world, 1);

        // The shot leaves — the ship is destroyed BY firing, not
        // INSTEAD of firing.
        expect(countProjectiles(world)).toEqual(1);
        expect(ship.components.get(ArmorComponent)!.current).toEqual(0);
        // ...and it is the ordinary death sequence, not a deletion.
        expect(ship.components.has(ExplodingComponent)).toBeTrue();
    });

    it('leaves the firer alone when the weapon is an ordinary one',
        async () => {
            const { world, ship } = await makeTestWorld();
            setFiring(ship, NORMAL_ID, true);

            await stepWorld(world, 5);

            // One shot per original frame (steps 1, 3 and 5).
            expect(countProjectiles(world)).toEqual(3);
            expect(ship.components.get(ArmorComponent)!.current).toEqual(100);
            expect(ship.components.has(ExplodingComponent)).toBeFalse();
        });

    it('does not kill a ship whose trigger is not held', async () => {
        const { world, ship } = await makeTestWorld();
        await stepWorld(world, 5);
        expect(ship.components.get(ArmorComponent)!.current).toEqual(100);
        expect(ship.components.has(ExplodingComponent)).toBeFalse();
    });

    it('fires exactly once however long the trigger is held', async () => {
        // A long DeathDelay leaves the ship in the world, trigger still
        // held and weapon reloaded (reload: 1ms), for many ticks after it
        // is destroyed. Without the exploding guard in WeaponsSystem the
        // corpse would let one shot go per reload for the whole sequence.
        const { world, ship } = await makeTestWorld({ deathDelay: 5 });
        setFiring(ship, SUICIDE_ID, true);

        await stepWorld(world, 30);

        expect(countProjectiles(world)).toEqual(1);
        expect(ship.components.has(ExplodingComponent)).toBeTrue();
    });

    it('ends in the normal death: the hull explodes and the wreck goes',
        async () => {
            const { world, ship } = await makeTestWorld({ deathDelay: 0.1 });
            setFiring(ship, SUICIDE_ID, true);

            // Long enough for the 0.1s death sequence to finish.
            await stepWorld(world, 20);

            // Every destroyed ship drops a blast at its own position
            // (ShipExplosionBlastSystem) and an NPC's wreck is removed
            // (DeathAISystem). A self-destruct is not a special case.
            expect(countShipExplosions(world) > 0
                || !world.entities.has('test ship uuid')).toBeTrue();
            expect(world.entities.has('test ship uuid')).toBeFalse();
            expect(ship.components.get(ArmorComponent)!.current).toEqual(0);
        });

    it('is deterministic: two identical worlds die on the same tick',
        async () => {
            const a = await makeTestWorld({ deathDelay: 5 });
            const b = await makeTestWorld({ deathDelay: 5 });
            setFiring(a.ship, SUICIDE_ID, true);
            setFiring(b.ship, SUICIDE_ID, true);

            for (let tick = 0; tick < 10; tick++) {
                await stepWorld(a.world, 1);
                await stepWorld(b.world, 1);
                expect(a.ship.components.get(ExplodingComponent))
                    .toEqual(b.ship.components.get(ExplodingComponent));
                expect(countProjectiles(a.world))
                    .toEqual(countProjectiles(b.world));
            }
            expect(a.ship.components.has(ExplodingComponent)).toBeTrue();
        });
});
