import 'jasmine';
import { BeamWeaponData } from 'novadatainterface/weapon_data';
import { RunQuery, UUID } from 'nova_ecs/arg_types';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { System } from 'nova_ecs/system';
import { World } from 'nova_ecs/world';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
import { BeamDataComponent } from './beam_plugin.js';
import { DamagedEvent, ExplodingComponent } from './death_plugin.js';
import { completeEntity } from './entity_data_loader.js';
import {
    OwnerComponent, VulnerableToPD, WeaponConstructors, WeaponEntries, WeaponEntry,
} from './fire_weapon_plugin.js';
import { makeShip } from './make_ship.js';
import { makeSystem } from './make_system.js';
import { TargetComponent } from './target_component.js';

const SHIP_ID = 'nova:128';        // Shuttle.
const ION_CANNON = 'nova:142';     // beamTurret, 240 long, 33ms duration.
const POLARON_CANNON = 'nova:141'; // plain 'beam', 180 long, 33ms duration.

/**
 * A beam turret is a ray held on its target: it is re-aimed every tick,
 * from the firing ship's own position and heading. When the target stops
 * existing the aiming step is skipped, and the ray was left pointing
 * straight out of the ship's nose — a full-strength beam firing forward
 * for a frame, and DAMAGING whatever was in front of it.
 *
 * Two separate frames could show it, and both are pinned here:
 *   - the beam already in flight, re-aimed on the tick after its own
 *     victim died (the playtest report);
 *   - a NEW beam fired from a lock naming an entity that is already gone
 *     — target uuids outlive their entities, because DeleteEvent is
 *     queued rather than immediate.
 *
 * The battlefield is nova:226 (Ver'ashan, asteroid-free) so nothing but
 * the ships placed here can be hit. Geometry: the shooter faces -y (Nova
 * rotation 0) with an innocent BYSTANDER straight ahead in beam range,
 * and the VICTIM off to the +x side. A correctly aimed turret shot goes
 * sideways and never touches the bystander, so ANY bystander damage is
 * the forward-firing bug.
 */
describe('beam turret with a dead target', () => {
    let damaged: Array<{ uuid: string, damager: string }>;

    type GameData = Awaited<ReturnType<typeof getIntegrationGameData>>;

    async function makeBattlefield() {
        const gameData = await getIntegrationGameData();
        const world = await makeSystem('nova:226', gameData, undefined,
            { npcs: false });
        damaged = [];
        world.addSystem(new System({
            name: 'BeamTurretDamageRecorder',
            events: [DamagedEvent],
            args: [DamagedEvent, UUID] as const,
            step({ damager }, uuid) {
                damaged.push({ uuid, damager });
            },
        }));
        return { gameData, world };
    }

    function pin(ship: Entity, x: number, y: number) {
        ship.components.set(MovementStateComponent, {
            position: new Position(x, y),
            velocity: new Vector(0, 0),
            rotation: new Angle(0),
            accelerating: 0,
            turning: 0,
            turnBack: false,
        });
    }

    async function addShip(world: World, gameData: GameData, uuid: string,
        x: number, y: number) {
        const ship = makeShip(await gameData.data.Ship.get(SHIP_ID));
        ship.components.set(MultiplayerData, { owner: 'server' });
        await completeEntity(world, ship);
        pin(ship, x, y);
        world.entities.set(uuid, ship);
        return ship;
    }

    function beamCount(world: World) {
        let count = 0;
        for (const [, entity] of world.entities) {
            if (entity.components.has(BeamDataComponent)) {
                count++;
            }
        }
        return count;
    }

    function hits(uuid: string) {
        return damaged.filter(entry => entry.uuid === uuid).length;
    }

    /**
     * Shooter at (1000, 1000) facing -y, bystander 60 ahead of it, and a
     * victim 60 off to the +x side that the shooter is targeting. Both
     * are well inside the Ion Cannon's 240-unit reach, and close enough
     * that the weapon's own 4-degree inaccuracy (sampled once as the beam
     * leaves the ship, and held for its life) cannot throw the ray clear
     * of a Shuttle's 14x17 hitbox.
     */
    async function setUp() {
        const { gameData, world } = await makeBattlefield();
        const shooter = await addShip(world, gameData, 'shooter', 1000, 1000);
        const bystander = await addShip(world, gameData, 'bystander', 1000, 940);
        const victim = await addShip(world, gameData, 'victim', 1060, 1000);
        shooter.components.set(TargetComponent, { target: 'victim' });

        // Let the providers attach hitboxes/hurtboxes.
        for (let i = 0; i < 20; i++) {
            world.step();
        }
        pin(shooter, 1000, 1000);
        pin(bystander, 1000, 940);
        pin(victim, 1060, 1000);
        return { gameData, world, shooter, bystander, victim };
    }

    async function getWeapon(world: World, id: string) {
        const weapon = await world.resources.get(WeaponEntries)!.get(id);
        expect(weapon).withContext(`weapon ${id} loaded`).toBeDefined();
        return weapon!;
    }

    /** Fires once with inaccuracy off, so the geometry is exact. */
    function fire(weapon: WeaponEntry) {
        return weapon.fireFromEntity('shooter', false);
    }

    function settle(world: World, ticks = 5) {
        for (let i = 0; i < ticks; i++) {
            world.step();
        }
    }

    it('hits the target it is aimed at, and not the ship in front of it',
        async () => {
            const { world } = await setUp();
            const ionCannon = await getWeapon(world, ION_CANNON);

            expect(fire(ionCannon))
                .withContext('a turret with a live target fires').toBeDefined();
            settle(world);

            expect(hits('victim'))
                .withContext('the aimed-at victim takes the beam')
                .toBeGreaterThan(0);
            expect(damaged.filter(({ uuid }) => uuid === 'bystander'))
                .withContext('the ship straight ahead is untouched')
                .toEqual([]);
        }, 120_000);

    // The playtest report: the beam that killed the target is still
    // alive on the following tick, and used to swing onto the ship's
    // heading for its last frame.
    it('a beam in flight does not swing forward when its target dies',
        async () => {
            const { world } = await setUp();
            const ionCannon = await getWeapon(world, ION_CANNON);

            expect(fire(ionCannon)).withContext('the shot spawns').toBeDefined();
            world.step();
            expect(beamCount(world))
                .withContext('the beam outlives the tick it was fired on')
                .toBeGreaterThan(0);

            // The victim is destroyed while the beam is still burning.
            world.entities.delete('victim');
            damaged = [];
            settle(world);

            expect(hits('bystander'))
                .withContext('the beam never sweeps the ship in front')
                .toBe(0);
            expect(beamCount(world))
                .withContext('the targetless beam is gone')
                .toBe(0);
        }, 120_000);

    it('fires nothing from a lock whose entity is already gone', async () => {
        const { world } = await setUp();
        const ionCannon = await getWeapon(world, ION_CANNON);

        // Deleted, but the shooter's TargetComponent still names it:
        // DeleteEvent is queued, so every system that runs before the
        // queue is flushed still sees the stale uuid.
        world.entities.delete('victim');
        damaged = [];

        const spawned = fire(ionCannon);
        settle(world);

        expect(spawned)
            .withContext('no shot spawns for a targetless turret')
            .toBeUndefined();
        expect(beamCount(world))
            .withContext('no beam entity exists')
            .toBe(0);
        expect(damaged)
            .withContext('nothing is damaged - especially not straight ahead')
            .toEqual([]);
    }, 120_000);

    it('fires nothing at a target that is exploding', async () => {
        const { world, victim } = await setUp();
        const ionCannon = await getWeapon(world, ION_CANNON);

        // Armor gone: the ship is a fireball, not something to aim at.
        victim.components.set(ExplodingComponent, Infinity);
        damaged = [];

        const spawned = fire(ionCannon);
        settle(world);

        expect(spawned)
            .withContext('no shot spawns at an exploding target')
            .toBeUndefined();
        expect(beamCount(world)).withContext('no beam entity exists').toBe(0);
        expect(damaged)
            .withContext('neither the wreck nor the bystander is damaged')
            .toEqual([]);
    }, 120_000);

    // Control: a FIXED beam is not aimed at anything. It fires straight
    // out of the ship whether or not there is a target, so losing the
    // target must not silence it.
    it('a fixed beam still fires forward with a dead target', async () => {
        const { world } = await setUp();
        const polaron = await getWeapon(world, POLARON_CANNON);

        world.entities.delete('victim');
        damaged = [];

        expect(fire(polaron))
            .withContext('a fixed beam fires regardless of target')
            .toBeDefined();
        settle(world);

        expect(hits('bystander'))
            .withContext('and hits what is in front of it')
            .toBeGreaterThan(0);
    }, 120_000);

    // Control: a point-defense beam picks its own victim out of the live
    // world every time it fires and ignores the ship's target entirely,
    // so a dead ship target must not silence it either. No stock weapon
    // has pointDefenseBeam guidance, so build one from a real beam.
    describe('point defense beam', () => {
        async function makePointDefenseBeam(world: World, gameData: GameData) {
            const construct = world.resources
                .get(WeaponConstructors)!.get('BeamWeaponData')!;
            const data = await gameData.data.Weapon.get(ION_CANNON);
            return new construct({
                ...(data as BeamWeaponData),
                id: 'test:pd_beam',
                guidance: 'pointDefenseBeam',
            }, world.resources.get(RunQuery)!);
        }

        /** An incoming missile-like entity aimed at the shooter. */
        function addIncoming(world: World, uuid: string, x: number, y: number) {
            const incoming = new Entity()
                .addComponent(MovementStateComponent, {
                    position: new Position(x, y),
                    velocity: new Vector(0, 0),
                    rotation: new Angle(0),
                    accelerating: 0,
                    turning: 0,
                    turnBack: false,
                })
                .addComponent(VulnerableToPD, undefined)
                .addComponent(OwnerComponent, { owner: 'bystander' })
                .addComponent(TargetComponent, { target: 'shooter' });
            world.entities.set(uuid, incoming);
            return incoming;
        }

        it('still fires at an incoming shot when the ship target is dead',
            async () => {
                const { gameData, world } = await setUp();
                const pdBeam = await makePointDefenseBeam(world, gameData);

                world.entities.delete('victim');
                addIncoming(world, 'incoming', 1100, 1000);

                expect(fire(pdBeam))
                    .withContext('point defense picks its own victim')
                    .toBeDefined();
            }, 120_000);

        it('fires nothing when there is no incoming shot', async () => {
            const { gameData, world } = await setUp();
            const pdBeam = await makePointDefenseBeam(world, gameData);

            expect(fire(pdBeam))
                .withContext('nothing to shoot down')
                .toBeUndefined();
        }, 120_000);
    });
});
