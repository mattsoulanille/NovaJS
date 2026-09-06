import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultOutfitData } from 'novadatainterface/outfit_data';
import {
    getDefaultShipData, getDefaultShipPhysics,
} from 'novadatainterface/ship_data';
import {
    BayWeaponData, getDefaultBayWeaponData,
    getDefaultProjectileWeaponData, ProjectileWeaponData,
} from 'novadatainterface/weapon_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import { BayFighterComponent } from '../escorts/bay_plugin.js';
import { ExplodingComponent } from '../ship/death_plugin.js';
import { completeEntity } from '../spawn/entity_data_loader.js';
import { EscortCommandComponent } from '../player/escort_command.js';
import { ArmorComponent, ShieldComponent } from '../ship/health_plugin.js';
import { makeShip } from '../ship/make_ship.js';
import { makeSystem } from '../make_system.js';
import { DeathAIComponent } from '../npc/npc_plugin.js';
import { OutfitsStateComponent } from '../ship/outfit_plugin.js';
import { ProjectileComponent } from '../core/projectile_data.js';
import { ControlledByComponent } from '../player/ship_control.js';
import { TargetComponent } from '../ship/target_component.js';
import { weaponReach } from '../ship/weapon_range.js';
import { WeaponsStateComponent } from '../ship/weapons_state.js';

/**
 * ============================================================================
 * The Intelligent EMP Torpedo, in the shape the plug-in actually builds
 * ============================================================================
 *
 * Nova_Data/Plug-ins/"Intelligent EMP Torpedo" is a fighter BAY (wëap
 * 262, guidance 99) whose "fighter" is a torpedo (shïp 666) armed with a
 * wëap whose AmmoType is -999 (wëap 261 "CD exp"). So the torpedo is
 * commanded like any other escort, flies into an enemy, fires — and the
 * act of firing destroys it, delivering a 100/340 hit with a 100px blast.
 *
 * The numbers below mirror the real ones (a 45px/s shot living 100ms
 * behind a 120px proximity fuse: a reach of ~124px, against an escort
 * fire radius of 1200px), because the whole feature turns on that gap.
 * The plug-in's own resources are pinned separately, in
 * emp_torpedo_plugin_integration_test.ts; this spec is the BEHAVIOUR, and
 * it runs everywhere.
 */

const CARRIER_SHIP = 'test:carrierShip';
const TORPEDO_SHIP = 'test:torpedoShip';
const ENEMY_SHIP = 'test:enemyShip';
const BAY_ID = 'test:bay';
const BAY_OUTFIT = 'test:bayOutfit';
const TORPEDO_OUTFIT = 'test:torpedoOutfit';
const WARHEAD_ID = 'test:warhead';
const WARHEAD_OUTFIT = 'test:warheadOutfit';
const CARRIER = 'test carrier';
const ENEMY = 'test enemy';

async function stepWorld(world: World, steps: number) {
    for (let i = 0; i < steps; i++) {
        world.step();
        await new Promise(resolve => setImmediate(resolve));
    }
}

function fighters(world: World): [string, Entity][] {
    return [...world.entities]
        .filter(([, entity]) => entity.components.has(BayFighterComponent));
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

/**
 * A player carrier at the origin with one loaded bay, and an enemy 500px
 * away. `destroyShipWhenFiring` is a knob so the same battlefield can be
 * run with an ordinary warhead as the control.
 */
async function makeWorld({ destroyShipWhenFiring = true } = {}) {
    const gameData = new MockGameData();

    const warhead: ProjectileWeaponData = {
        ...getDefaultProjectileWeaponData(),
        id: WARHEAD_ID,
        reload: 1,
        fireGroup: 'primary',
        guidance: 'turret',
        ammoType: 'unlimited',
        destroyShipWhenFiring,
        // ~124px of reach: 45px/s for 100ms, behind a 120px fuse.
        shotDuration: 100,
        proxRadius: 120,
        blastRadius: 100,
        physics: { ...getDefaultProjectileWeaponData().physics, speed: 45 },
        damage: {
            ...getDefaultProjectileWeaponData().damage,
            shield: 340,
            armor: 100,
        },
    };
    gameData.data.Weapon.map.set(WARHEAD_ID, warhead);
    gameData.data.Outfit.map.set(WARHEAD_OUTFIT, {
        ...getDefaultOutfitData(),
        id: WARHEAD_OUTFIT,
        weapons: { [WARHEAD_ID]: 1 },
    });

    const bay: BayWeaponData = {
        ...getDefaultBayWeaponData(),
        id: BAY_ID,
        shipID: TORPEDO_SHIP,
        ammoType: ['weapon', BAY_ID],
        maxAmmo: 4,
        fireGroup: 'secondary',
        reload: 1,
    };
    gameData.data.Weapon.map.set(BAY_ID, bay);
    gameData.data.Outfit.map.set(BAY_OUTFIT, {
        ...getDefaultOutfitData(),
        id: BAY_OUTFIT,
        weapons: { [BAY_ID]: 1 },
    });
    gameData.data.Outfit.map.set(TORPEDO_OUTFIT, {
        ...getDefaultOutfitData(),
        id: TORPEDO_OUTFIT,
        ammoFor: BAY_ID,
    });

    // Fast and flimsy, like the real shïp 666 (600px/s, 20 armor).
    gameData.data.Ship.map.set(TORPEDO_SHIP, {
        ...getDefaultShipData(),
        id: TORPEDO_SHIP,
        deathDelay: 0.1,
        outfits: { [WARHEAD_OUTFIT]: 1 },
        physics: {
            ...getDefaultShipPhysics(),
            speed: 600, acceleration: 600, turnRate: 6,
            armor: 20, shield: 20, armorRecharge: 0, shieldRecharge: 0,
        },
    });
    gameData.data.Ship.map.set(ENEMY_SHIP, {
        ...getDefaultShipData(),
        id: ENEMY_SHIP,
        physics: {
            ...getDefaultShipPhysics(),
            armorRecharge: 0, shieldRecharge: 0,
        },
    });
    gameData.data.Ship.map.set(CARRIER_SHIP, {
        ...getDefaultShipData(),
        id: CARRIER_SHIP,
        outfits: { [BAY_OUTFIT]: 1, [TORPEDO_OUTFIT]: 4 },
    });

    const world = await makeSystem('test:system', gameData, undefined,
        { npcs: false });
    async function addShip(uuid: string, shipId: string, x: number, y: number,
        setup: (ship: Entity) => void = () => { }) {
        const ship = makeShip(gameData.data.Ship.map.get(shipId)!);
        ship.components.set(MovementStateComponent, {
            accelerating: 0,
            position: new Position(x, y),
            rotation: new Angle(0),
            turnBack: false,
            turning: 0,
            velocity: new Vector(0, 0),
        });
        setup(ship);
        await completeEntity(world, ship);
        world.entities.set(uuid, ship);
        return ship;
    }

    const carrier = await addShip(CARRIER, CARRIER_SHIP, 0, 0, ship => {
        ship.components.set(ControlledByComponent, { peerId: 'test peer' });
        ship.components.set(TargetComponent, { target: ENEMY });
    });
    // A sitting duck: no AI, so it neither shoots back nor runs.
    const enemy = await addShip(ENEMY, ENEMY_SHIP, 500, 0, ship => {
        ship.components.set(DeathAIComponent, undefined);
    });

    await stepWorld(world, 2);
    return { world, carrier, enemy };
}

/** Fires the carrier's bay once and returns the torpedo it launched. */
async function launch(world: World, carrier: Entity) {
    const bay = carrier.components.get(WeaponsStateComponent)!.get(BAY_ID)!;
    bay.firing = true;
    await stepWorld(world, 1);
    bay.firing = false;
    // Let the torpedo's providers attach its weapons, armor and physics.
    await stepWorld(world, 2);
    const launched = fighters(world);
    expect(launched.length).toBe(1);
    return launched[0];
}

/** The player's "attack my target" order, as EscortCommandInputSystem
 * writes it. */
function orderAttack(fighter: Entity) {
    fighter.components.set(EscortCommandComponent,
        { command: 'attack', target: ENEMY });
}

describe('a bay fighter armed with a self-destruct weapon', () => {
    it('reaches ~124px, which is far inside the escort fire radius', () => {
        // The premise of the whole feature: the flat 1200px fire radius
        // is two orders of magnitude past where this shot can connect.
        const warhead: ProjectileWeaponData = {
            ...getDefaultProjectileWeaponData(),
            shotDuration: 100, proxRadius: 120,
            physics: { ...getDefaultProjectileWeaponData().physics, speed: 45 },
        };
        expect(weaponReach(warhead)).toBeCloseTo(124.5, 1);
    });

    it('holds its fire at long range instead of blowing itself up',
        async () => {
            const { world, carrier } = await makeWorld();
            const [, torpedo] = await launch(world, carrier);
            orderAttack(torpedo);

            // One tick: the order lands, the torpedo is still ~500px out.
            await stepWorld(world, 1);

            expect(countProjectiles(world)).toBe(0);
            expect(torpedo.components.has(ExplodingComponent)).toBeFalse();
            expect(torpedo.components.get(WeaponsStateComponent)!
                .get(WARHEAD_ID)!.firing).toBeFalse();
        });

    it('an ordinary warhead at the same range fires immediately (control)',
        async () => {
            const { world, carrier } = await makeWorld({
                destroyShipWhenFiring: false,
            });
            const [, torpedo] = await launch(world, carrier);
            orderAttack(torpedo);

            await stepWorld(world, 2);

            // 500px is inside ESCORT_FIRE_RANGE, so nothing holds this one.
            expect(countProjectiles(world)).toBeGreaterThan(0);
            expect(torpedo.components.has(ExplodingComponent)).toBeFalse();
        });

    it('closes on its victim, fires, dies, and lands the damage',
        async () => {
            const { world, carrier, enemy } = await makeWorld();
            const [torpedoUuid, torpedo] = await launch(world, carrier);
            const startDistance = torpedo.components
                .get(MovementStateComponent)!.position
                .subtract(enemy.components.get(MovementStateComponent)!
                    .position).length;
            expect(startDistance).toBeGreaterThan(400);
            orderAttack(torpedo);

            // Enough sim time to cross 500px at 600px/s and detonate.
            await stepWorld(world, 120);

            // It spent itself: the wreck is gone (DeathAISystem removes a
            // bay fighter's) rather than orbiting forever.
            expect(world.entities.has(torpedoUuid)).toBeFalse();
            // And the victim wears it. 340 shield damage against a 100
            // point shield carries into armor.
            const shield = enemy.components.get(ShieldComponent)!;
            const armor = enemy.components.get(ArmorComponent)!;
            expect(shield.current).toBeLessThan(shield.max);
            expect(armor.current).toBeLessThan(armor.max);
        });

    it('spends one fighter from the magazine and never refunds it',
        async () => {
            const { world, carrier } = await makeWorld();
            const outfits = () => carrier.components
                .get(OutfitsStateComponent)?.get(TORPEDO_OUTFIT)?.count ?? 0;
            const before = outfits();
            const [, torpedo] = await launch(world, carrier);
            expect(outfits()).toBe(before - 1);

            orderAttack(torpedo);
            await stepWorld(world, 120);

            // Docking is what refunds a fighter; dying is not docking.
            expect(outfits()).toBe(before - 1);
        });
});
