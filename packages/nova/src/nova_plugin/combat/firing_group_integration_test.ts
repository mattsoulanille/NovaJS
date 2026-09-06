import 'jasmine';
import { UUID } from 'nova_ecs/arg_types';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { System } from 'nova_ecs/system';
import { World } from 'nova_ecs/world';
import { getIntegrationGameData } from '../../communication/simulation_test_fixture.js';
import { DamagedEvent } from '../ship/death_plugin.js';
import { completeEntity, loadShipGameData } from '../spawn/entity_data_loader.js';
import { WeaponEntries } from './fire_weapon_plugin.js';
import { FiringGroupComponent } from '../ship/firing_group.js';
import { makeShip } from '../ship/make_ship.js';
import { makeSystem } from '../make_system.js';
import { NpcComponent } from '../npc/npc_ai_plugin.js';

const SHIP_ID = 'nova:128'; // Shuttle: carries an unguided projectile weapon.

/**
 * End-to-end pin of fleet friendly-fire immunity against real Nova
 * data: a fleet member's real weapon, fired through the real weapon
 * pipeline, must pass through its leader (no DamagedEvent, and the
 * leader records no aggressor — the retaliation trigger of the
 * observed bug), while the identical shot from an outsider hits.
 */
describe('firing group friendly fire against real Nova data', () => {
    let damaged: Array<{ uuid: string, damager: string }>;

    /** nova:226 (Ver'ashan) is asteroid-free: a controlled
     * battlefield for collision choreography (same adaptation as the
     * bay-escort spec). */
    async function makeBattlefield() {
        const gameData = await getIntegrationGameData();
        const world = await makeSystem('nova:226', gameData, undefined,
            { npcs: false });
        damaged = [];
        world.addSystem(new System({
            name: 'DamageRecorder',
            events: [DamagedEvent],
            args: [DamagedEvent, UUID] as const,
            step({ damager }, uuid) {
                damaged.push({ uuid, damager });
            },
        }));
        return { gameData, world };
    }

    async function addShip(world: World,
        gameData: Awaited<ReturnType<typeof getIntegrationGameData>>,
        uuid: string, x: number, y: number) {
        const shipData = await gameData.data.Ship.get(SHIP_ID);
        const ship = makeShip(shipData);
        ship.components.set(MultiplayerData, { owner: 'server' });
        await completeEntity(world, ship);
        ship.components.set(MovementStateComponent, {
            position: new Position(x, y),
            velocity: new Vector(0, 0),
            rotation: new Angle(0),
            accelerating: 0,
            turning: 0,
            turnBack: false,
        });
        world.entities.set(uuid, ship);
        return ship;
    }

    /** The ship's first unguided projectile weapon (its blaser). */
    async function findGun(gameData:
        Awaited<ReturnType<typeof getIntegrationGameData>>) {
        const weaponIds = await loadShipGameData(gameData, SHIP_ID);
        for (const id of [...weaponIds].sort()) {
            const weapon = await gameData.data.Weapon.get(id);
            if (weapon.type === 'ProjectileWeaponData'
                && weapon.guidance === 'unguided') {
                return id;
            }
        }
        throw new Error(`No unguided projectile weapon on ${SHIP_ID}`);
    }

    /** Re-anchors a (possibly AI-steered) ship so the shot geometry is
     * identical in both phases: shots fly -y from the shooter's exit
     * point, sweeping through a ship pinned 60px downstream. */
    function pin(ship: Awaited<ReturnType<typeof addShip>>,
        x: number, y: number) {
        ship.components.set(MovementStateComponent, {
            position: new Position(x, y),
            velocity: new Vector(0, 0),
            rotation: new Angle(0),
            accelerating: 0,
            turning: 0,
            turnBack: false,
        });
    }

    it('a fleet member\'s shot passes through its leader; '
        + 'an outsider\'s hits', async () => {
        const { gameData, world } = await makeBattlefield();
        const gunId = await findGun(gameData);
        const gun = await world.resources.get(WeaponEntries)!.get(gunId);
        expect(gun).toBeDefined();

        // Far from the system's planets so nothing else intersects the
        // shot path.
        const leader = await addShip(world, gameData, 'leader', 1000, 1000);
        leader.components.set(FiringGroupComponent, { group: 'leader' });
        leader.components.set(NpcComponent, { aiType: 2 });
        const escort = await addShip(world, gameData, 'escort', 1000, 1060);
        escort.components.set(FiringGroupComponent, { group: 'leader' });

        // Let the providers attach hitboxes/hurtboxes before firing.
        for (let i = 0; i < 20; i++) {
            world.step();
        }

        // Phase 1: the escort fires straight through its leader.
        // (inaccuracy off: identical deterministic geometry per phase.)
        pin(leader, 1000, 1000);
        pin(escort, 1000, 1060);
        const friendly = gun!.fireFromEntity('escort', false);
        expect(friendly).withContext('escort shot spawned').toBeDefined();
        expect(friendly!.components.get(FiringGroupComponent))
            .withContext('shot inherits the fleet group')
            .toEqual({ group: 'leader' });
        for (let i = 0; i < 30; i++) {
            world.step();
        }

        expect(damaged.filter(({ uuid }) => uuid === 'leader'))
            .withContext('no friendly DamagedEvent on the leader')
            .toEqual([]);
        expect(leader.components.get(NpcComponent)?.aggressor)
            .withContext('the leader never marks its escort as aggressor')
            .toBeUndefined();

        // Phase 2: the identical shot from an outsider (no shared
        // group) hits and registers as aggression.
        const outsider = await addShip(world, gameData, 'outsider', 0, 0);
        for (let i = 0; i < 20; i++) {
            world.step();
        }
        pin(leader, 1000, 1000);
        pin(escort, 3000, 3000); // Out of the line of fire.
        pin(outsider, 1000, 1060);
        const hostile = gun!.fireFromEntity('outsider', false);
        expect(hostile).withContext('outsider shot spawned').toBeDefined();
        for (let i = 0; i < 30; i++) {
            world.step();
        }

        expect(damaged.filter(({ uuid }) => uuid === 'leader').length)
            .withContext('the outsider\'s shot connects with the leader')
            .toBeGreaterThan(0);
        expect(leader.components.get(NpcComponent)?.aggressor)
            .withContext('the hit leader records the outsider as aggressor')
            .toBe('outsider');
    }, 120_000);
});

/**
 * Pins the guided-target data plumbing against real Nova data: the
 * wëap Flags2 0x0008 flag ("Proximity detonator is triggered by ships
 * other than the target (for guided weapons)") reaches the simulation
 * as ProjectileWeaponData.proxHitAll, forced true for non-guided
 * weapons.
 */
describe('proxHitAll against real Nova data', () => {
    it('guided missiles are target-only unless flagged; '
        + 'non-guided weapons always hit anyone', async () => {
        const gameData = await getIntegrationGameData();
        const ids = [...(await gameData.ids).Weapon].sort();
        let guided = 0;
        let guidedTargetOnly = 0;
        for (const id of ids) {
            let weapon;
            try {
                weapon = await gameData.data.Weapon.get(id);
            } catch {
                continue;
            }
            if (weapon.type !== 'ProjectileWeaponData') {
                continue;
            }
            if (weapon.guidance === 'guided') {
                guided++;
                if (!weapon.proxHitAll) {
                    guidedTargetOnly++;
                }
            } else {
                expect(weapon.proxHitAll)
                    .withContext(`non-guided ${id} must hit anyone`)
                    .toBeTrue();
            }
        }
        expect(guided).toBeGreaterThan(0);
        // Stock homing weapons are overwhelmingly target-only.
        expect(guidedTargetOnly).toBeGreaterThan(0);
    }, 300_000);
});
