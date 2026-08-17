import 'jasmine';
import { getDefaultBeamWeaponData, getDefaultProjectileWeaponData, getDefaultSeekerFlags } from 'novadatainterface/weapon_data';
import SAT from 'sat';
import { UUID } from 'nova_ecs/arg_types';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { TimePlugin, useFixedTimestep } from 'nova_ecs/plugins/time_plugin';
import { System } from 'nova_ecs/system';
import { World } from 'nova_ecs/world';
import { AsteroidComponent } from './asteroid_plugin.js';
import { BeamCollisionSystem, BeamDataComponent, BeamStateComponent } from './beam_plugin.js';
import { BlastDamageComponent } from './blast_data.js';
import { BlastCollisionSystem } from './blast_plugin.js';
import { CollisionEvent } from './collision_interaction.js';
import { CompositeHull, HitboxHullComponent } from './collisions_plugin.js';
import { CreateTime } from './create_time.js';
import { DamagedEvent } from './death_plugin.js';
import { DisabledComponent } from './disabled_component.js';
import { FireSubs, OwnerComponent, SourceComponent } from './fire_weapon_plugin.js';
import { disabledCancelsImmunity, FiringGroupComponent, firingImmune, victimFiringGroup } from './firing_group.js';
import { GovtComponent } from './govt_component.js';
import { ProjectileDataComponent } from './projectile_data.js';
import { ProjectileCollisionSystem } from './projectile_plugin.js';
import { TargetComponent } from './target_component.js';

describe('firingImmune (pair-immunity predicate)', () => {
    it('blocks a hit between members of the same group', () => {
        expect(firingImmune('fleet-1', 'fleet-1', undefined, undefined))
            .toBeTrue();
    });

    it('allows a hit between different groups', () => {
        expect(firingImmune('fleet-1', 'fleet-2', undefined, undefined))
            .toBeFalse();
    });

    it('never matches when the weapon has no group', () => {
        // An ownerless weapon must not match every group-less victim.
        expect(firingImmune(undefined, undefined, undefined, undefined))
            .toBeFalse();
        expect(firingImmune(undefined, 'ship-1', undefined, undefined))
            .toBeFalse();
    });

    it('cancels immunity when the victim is disabled', () => {
        // A DISABLED ship forfeits its friendly-fire protection even
        // against its own group; once repaired (not disabled) it is
        // immune again.
        expect(firingImmune('fleet-1', 'fleet-1', undefined, undefined, true))
            .toBeFalse();
        expect(firingImmune('fleet-1', 'fleet-1', undefined, undefined, false))
            .toBeTrue();
        // The default (omitted) is "not disabled".
        expect(firingImmune('fleet-1', 'fleet-1', undefined, undefined))
            .toBeTrue();
    });

    it('keeps the same-govt clause DISABLED (pending research)', () => {
        // Same govt, different groups: NOT immune while
        // SAME_GOVT_FIRING_IMMUNITY is false. Flipping that constant
        // (firing_group.ts) is the one-line enable.
        expect(firingImmune('fleet-1', 'fleet-2', 'nova:200', 'nova:200'))
            .toBeFalse();
        expect(firingImmune(undefined, 'ship-1', 'nova:200', 'nova:200'))
            .toBeFalse();
    });
});

describe('disabledCancelsImmunity', () => {
    it('cancels immunity for a disabled victim that is not the firer', () => {
        expect(disabledCancelsImmunity('mate', true, 'firer')).toBeTrue();
        expect(disabledCancelsImmunity('mate', true, undefined)).toBeTrue();
    });

    it('never cancels immunity for the shot\'s own firer', () => {
        expect(disabledCancelsImmunity('firer', true, 'firer')).toBeFalse();
    });

    it('leaves an undisabled victim alone', () => {
        expect(disabledCancelsImmunity('mate', false, 'firer')).toBeFalse();
    });
});

describe('victimFiringGroup', () => {
    it('prefers the explicit group, then the owner root, then the uuid', () => {
        expect(victimFiringGroup({ group: 'fleet-1' }, 'carrier', 'me'))
            .toBe('fleet-1');
        expect(victimFiringGroup(undefined, 'carrier', 'me')).toBe('carrier');
        expect(victimFiringGroup(undefined, undefined, 'me')).toBe('me');
    });
});

/**
 * ProjectileCollisionSystem behavior, exercised with hand-built worlds:
 * a projectile receives a CollisionEvent against a chosen victim and we
 * observe whether it deals damage / despawns.
 */
describe('ProjectileCollisionSystem filtering', () => {
    let world: World;
    let damaged: Array<{ uuid: string, damager: string }>;

    async function makeWorld() {
        const world = new World('firing-group-test');
        await world.addPlugin(TimePlugin);
        useFixedTimestep(world, 1000 / 60);
        world.resources.set(FireSubs, () => []);
        world.addSystem(ProjectileCollisionSystem);
        world.addSystem(new System({
            name: 'DamageRecorder',
            events: [DamagedEvent],
            args: [DamagedEvent, UUID] as const,
            step({ damager }, uuid) {
                damaged.push({ uuid, damager });
            },
        }));
        return world;
    }

    function movement(x = 0, y = 0) {
        return {
            position: new Position(x, y),
            velocity: new Vector(0, 0),
            rotation: new Angle(0),
            accelerating: 0,
            turning: 0,
            turnBack: false,
        };
    }

    function addShip(uuid: string) {
        const ship = new Entity(uuid)
            .addComponent(MovementStateComponent, movement());
        world.entities.set(uuid, ship);
        return ship;
    }

    /** A projectile with CreateTime 0 and the given weapon data tweaks. */
    function addProjectile(uuid: string,
        data: Partial<ReturnType<typeof getDefaultProjectileWeaponData>>) {
        const projectile = new Entity(uuid)
            .addComponent(ProjectileDataComponent, {
                ...getDefaultProjectileWeaponData(),
                ...data,
            })
            .addComponent(MovementStateComponent, movement())
            .addComponent(CreateTime, 0);
        world.entities.set(uuid, projectile);
        return projectile;
    }

    function collide(projectile: string, other: string) {
        world.emit(CollisionEvent, { other, initiator: true }, [projectile]);
        world.step();
    }

    function hits(victim: string) {
        return damaged.filter(({ uuid }) => uuid === victim);
    }

    beforeEach(async () => {
        world = await makeWorld();
        damaged = [];
    });

    describe('group immunity', () => {
        it('passes through a victim in the same firing group', () => {
            addShip('leader').components
                .set(FiringGroupComponent, { group: 'leader' });
            addProjectile('shot', {}).components
                .set(FiringGroupComponent, { group: 'leader' });
            collide('shot', 'leader');
            expect(hits('leader')).toEqual([]);
            expect(world.entities.get('shot'))
                .withContext('the shot keeps flying').toBeDefined();
        });

        it('hits a victim in a different firing group', () => {
            addShip('outsider').components
                .set(FiringGroupComponent, { group: 'other-fleet' });
            addProjectile('shot', {}).components
                .set(FiringGroupComponent, { group: 'leader' });
            collide('shot', 'outsider');
            expect(hits('outsider').length).toBe(1);
            expect(world.entities.get('shot'))
                .withContext('the shot is spent').toBeUndefined();
        });

        it('falls back to the owner chain when no group is stamped', () => {
            // Pre-group behavior: a projectile owned by X passes through
            // X and through entities owned by X.
            addShip('carrier');
            addShip('fighter').components
                .set(OwnerComponent, { owner: 'carrier' });
            const shot = addProjectile('shot', {});
            shot.components.set(OwnerComponent, { owner: 'carrier' });
            collide('shot', 'carrier');
            collide('shot', 'fighter');
            expect(damaged).toEqual([]);
        });

        it('hits a same-group victim once it is DISABLED', () => {
            // A disabled fleetmate loses immunity: your shot connects.
            const leader = addShip('leader');
            leader.components.set(FiringGroupComponent, { group: 'leader' });
            leader.components.set(DisabledComponent, { repairAt: null });
            addProjectile('shot', {}).components
                .set(FiringGroupComponent, { group: 'leader' });
            collide('shot', 'leader');
            expect(hits('leader').length).toBe(1);
        });

        it('never hits the DISABLED ship that fired it', () => {
            // The carve-out is for finishing off someone ELSE's hulk. A
            // ship's own shot passing back through itself is a different
            // thing, and it is exactly what a wëap with AmmoType -999
            // produces: the firer is destroyed as the shot leaves, is
            // marked disabled on the same tick, and the shot is still
            // sitting on top of it inside its proximity fuse.
            const firer = addShip('firer');
            firer.components.set(FiringGroupComponent, { group: 'firer' });
            firer.components.set(DisabledComponent, { repairAt: null });
            const shot = addProjectile('shot', {});
            shot.components.set(FiringGroupComponent, { group: 'firer' });
            shot.components.set(SourceComponent, 'firer');
            collide('shot', 'firer');
            expect(hits('firer')).toEqual([]);
            expect(world.entities.get('shot'))
                .withContext('the shot keeps flying').toBeDefined();
        });

        it('still hits a DISABLED fleetmate that did not fire it', () => {
            // The carve-out itself is untouched: only the firer is
            // exempt, not the rest of its group.
            const mate = addShip('mate');
            mate.components.set(FiringGroupComponent, { group: 'firer' });
            mate.components.set(DisabledComponent, { repairAt: null });
            const shot = addProjectile('shot', {});
            shot.components.set(FiringGroupComponent, { group: 'firer' });
            shot.components.set(SourceComponent, 'firer');
            collide('shot', 'mate');
            expect(hits('mate').length).toBe(1);
        });

        it('re-immunizes a same-group victim once repaired (not disabled)',
            () => {
                // Same setup without DisabledComponent: back to passing
                // through — the cancellation is scoped to the disabled state.
                addShip('leader').components
                    .set(FiringGroupComponent, { group: 'leader' });
                addProjectile('shot', {}).components
                    .set(FiringGroupComponent, { group: 'leader' });
                collide('shot', 'leader');
                expect(hits('leader')).toEqual([]);
            });

        it('same govt does NOT confer immunity while the clause is off', () => {
            addShip('same-govt-ship').components
                .set(GovtComponent, { id: 'nova:200' });
            addProjectile('shot', {}).components
                .set(FiringGroupComponent,
                    { group: 'fleet-1', govt: 'nova:200' });
            collide('shot', 'same-govt-ship');
            expect(hits('same-govt-ship').length).toBe(1);
        });
    });

    describe('guided weapons hit only their target', () => {
        function addMissile(target: string | undefined, seeker = {}) {
            const missile = addProjectile('missile', {
                guidance: 'guided',
                proxHitAll: false,
                seeker: { ...getDefaultSeekerFlags(), ...seeker },
            });
            missile.components.set(TargetComponent, { target });
            return missile;
        }

        it('passes through a ship it is not targeting', () => {
            addShip('bystander');
            addShip('target');
            addMissile('target');
            collide('missile', 'bystander');
            expect(hits('bystander')).toEqual([]);
            expect(world.entities.get('missile')).toBeDefined();
        });

        it('hits the ship it is targeting', () => {
            addShip('target');
            addMissile('target');
            collide('missile', 'target');
            expect(hits('target').length).toBe(1);
            expect(world.entities.get('missile')).toBeUndefined();
        });

        it('hits an asteroid it is not targeting', () => {
            addShip('rock').components
                .set(AsteroidComponent, { id: 'test:big', health: 100 });
            addShip('target');
            addMissile('target');
            collide('missile', 'rock');
            expect(hits('rock').length).toBe(1);
        });

        it('passes over asteroids with the passOverAsteroids seeker flag',
            () => {
                addShip('rock').components
                    .set(AsteroidComponent, { id: 'test:big', health: 100 });
                addShip('target');
                addMissile('target', { passOverAsteroids: true });
                collide('missile', 'rock');
                expect(hits('rock')).toEqual([]);
                expect(world.entities.get('missile')).toBeDefined();
            });

        it('hits the asteroid it was decoyed onto (retargeted)', () => {
            addShip('rock').components
                .set(AsteroidComponent, { id: 'test:big', health: 100 });
            // Jamming retargeted the missile's TargetComponent onto the
            // rock (decoyedByAsteroids); the target rule now admits it,
            // even for a passOverAsteroids missile.
            addMissile('rock',
                { passOverAsteroids: true, decoyedByAsteroids: true });
            collide('missile', 'rock');
            expect(hits('rock').length).toBe(1);
        });

        it('a guided missile with no target only hits asteroids', () => {
            addShip('bystander');
            addMissile(undefined);
            collide('missile', 'bystander');
            expect(hits('bystander')).toEqual([]);
        });

        it('leaves non-guided projectiles unchanged (proxHitAll)', () => {
            addShip('bystander');
            addShip('target');
            // Unguided weapons parse with proxHitAll forced true.
            const shot = addProjectile('shot', { proxHitAll: true });
            shot.components.set(TargetComponent, { target: 'target' });
            collide('shot', 'bystander');
            expect(hits('bystander').length).toBe(1);
        });
    });

    describe('blast group immunity', () => {
        function addBlast(uuid: string, group?: string) {
            const blast = new Entity(uuid)
                .addComponent(BlastDamageComponent,
                    { armor: 10 } as never)
                .addComponent(MovementStateComponent, movement());
            if (group) {
                blast.components.set(FiringGroupComponent, { group });
            }
            world.entities.set(uuid, blast);
            return blast;
        }

        beforeEach(() => {
            world.addSystem(BlastCollisionSystem);
        });

        it('spares members of the blast\'s firing group', () => {
            addShip('member').components
                .set(FiringGroupComponent, { group: 'fleet-1' });
            addBlast('blast', 'fleet-1');
            collide('blast', 'member');
            expect(hits('member')).toEqual([]);
        });

        it('damages ships outside the group', () => {
            addShip('outsider');
            addBlast('blast', 'fleet-1');
            collide('blast', 'outsider');
            expect(hits('outsider').length).toBe(1);
        });

        it('a group-less blast (blastHurtsFiringShip) damages everyone',
            () => {
                addShip('member').components
                    .set(FiringGroupComponent, { group: 'fleet-1' });
                addBlast('blast');
                collide('blast', 'member');
                expect(hits('member').length).toBe(1);
            });

        it('damages a DISABLED group member', () => {
            const member = addShip('member');
            member.components.set(FiringGroupComponent, { group: 'fleet-1' });
            member.components.set(DisabledComponent, { repairAt: null });
            addBlast('blast', 'fleet-1');
            collide('blast', 'member');
            expect(hits('member').length).toBe(1);
        });
    });

    describe('beam group immunity', () => {
        function addBeam(uuid: string, group?: string) {
            const beam = new Entity(uuid)
                .addComponent(BeamDataComponent, getDefaultBeamWeaponData())
                .addComponent(BeamStateComponent, {})
                .addComponent(MovementStateComponent, movement());
            if (group) {
                beam.components.set(FiringGroupComponent, { group });
            }
            world.entities.set(uuid, beam);
            return beam;
        }

        function addHullShip(uuid: string) {
            // A circle covering the beam origin: any beam hits at once.
            const ship = addShip(uuid);
            ship.components.set(HitboxHullComponent, new CompositeHull(
                [new SAT.Circle(new SAT.Vector(0, 0), 20)]));
            return ship;
        }

        beforeEach(() => {
            world.addSystem(BeamCollisionSystem);
        });

        it('passes through members of its firing group', () => {
            addHullShip('member').components
                .set(FiringGroupComponent, { group: 'fleet-1' });
            const beam = addBeam('beam', 'fleet-1');
            collide('beam', 'member');
            expect(beam.components.get(BeamStateComponent)?.targetHit)
                .toBeUndefined();
        });

        it('hits ships outside its firing group', () => {
            addHullShip('outsider');
            const beam = addBeam('beam', 'fleet-1');
            collide('beam', 'outsider');
            expect(beam.components.get(BeamStateComponent)?.targetHit)
                .toBe('outsider');
        });

        it('hits a DISABLED member of its firing group', () => {
            const member = addHullShip('member');
            member.components.set(FiringGroupComponent, { group: 'fleet-1' });
            member.components.set(DisabledComponent, { repairAt: null });
            const beam = addBeam('beam', 'fleet-1');
            collide('beam', 'member');
            expect(beam.components.get(BeamStateComponent)?.targetHit)
                .toBe('member');
        });
    });
});
