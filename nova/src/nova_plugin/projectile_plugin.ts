import { ProjectileWeaponData, WeaponData } from 'novadatainterface/WeaponData';
import { Emit, Entities, RunQueryFunction, UUID } from 'nova_ecs/arg_types';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity, EntityBuilder } from 'nova_ecs/entity';
import { EcsEvent } from 'nova_ecs/events';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { MovementPhysicsComponent, MovementStateComponent, MovementType } from 'nova_ecs/plugins/movement_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { System } from 'nova_ecs/system';
import { v4 } from 'uuid';
import { applyDamage, CollisionEvent, CollisionInteractionComponent } from './collision_interaction';
import { FireTimeProvider } from './fire_time';
import { FireSubs, OwnerComponent, WeaponConstructors, WeaponEntry } from './fire_weapon_plugin';
import { firstOrderWithFallback, Guidance, GuidanceComponent } from './guidance';
import { ArmorComponent, IonizationComponent, ShieldComponent } from './health_plugin';
import { ProjectileComponent, ProjectileDataComponent } from './projectile_data';
import { SoundEvent } from './sound_event';
import { TargetComponent } from './target_component';


class ProjectileWeaponEntry extends WeaponEntry {
    declare data: ProjectileWeaponData;
    constructor(data: WeaponData, runQuery: RunQueryFunction) {
        if (data.type !== 'ProjectileWeaponData') {
            throw new Error('Data must be ProjectileWeaponData');
        }
        super(data, runQuery);
    }

    fire(position: Position, angle: Angle, owner?: string, target?: string,
        source?: string, sourceVelocity?: Vector): Entity {

        let velocity = new Vector(0, 0);
        if (this.data.guidance !== 'guided' && sourceVelocity) {
            velocity = velocity.add(sourceVelocity);
        }
        if (this.data.guidance !== 'rocket') {
            velocity = velocity.add(angle.getUnitVector()
                .scale(this.data.physics.speed));
        }

        const projectile = new EntityBuilder()
            .setName(this.data.name)
            .addComponent(ProjectileDataComponent, this.data)
            .addComponent(ProjectileComponent, {
                id: this.data.id,
                source
            }).addComponent(MovementStateComponent, {
                position,
                rotation: angle,
                velocity,
                accelerating: this.data.guidance === 'rocket' ? 1 : 0,
                turning: 0,
                turnBack: false,
            }).addComponent(MovementPhysicsComponent, {
                acceleration: this.data.physics.acceleration || 1200,
                maxVelocity: this.data.guidance === 'rocket' ?
                    this.data.physics.speed : Infinity,
                turnRate: this.data.physics.turnRate,
                movementType: this.data.guidance === 'guided'
                    ? MovementType.INERTIALESS : MovementType.INERTIAL,
            }).addComponent(CollisionInteractionComponent, {
                hitTypes: new Set(['normal']),
            });

        if (target) {
            projectile.addComponent(TargetComponent, { target });
        }
        if (this.data.guidance === 'guided') {
            projectile.addComponent(GuidanceComponent, {
                guidance: Guidance.firstOrder
            });
        }
        if (owner) {
            projectile.addComponent(OwnerComponent, owner);
        }

        this.entities.set(v4(), projectile);
        if (this.data.sound) {
            this.emit(SoundEvent, this.data.sound);
        }

        return projectile;
    }
}

export const ProjectileExpireEvent = new EcsEvent<Entity>('ProjectileExpire');

const ProjectileLifespanSystem = new System({
    name: 'ProjectileLifespanSystem',
    args: [FireTimeProvider, TimeResource, ProjectileDataComponent, FireSubs,
        Entities, UUID, Emit, ProjectileComponent] as const,
    step(fireTime, { time }, projectileData, fireSubs, entities, uuid, emit) {
        if (time - fireTime > projectileData.shotDuration) {
            fireSubs(projectileData.id, uuid, true);
            const self = entities.get(uuid);
            if (!self) {
                console.warn(`Missing projectile ${uuid} that is expiring`);
                return;
            }
            entities.delete(uuid);
            emit(ProjectileExpireEvent, self);
        }
    },
});

const ProjectileGuidanceSystem = new System({
    name: 'ProjectileGuidanceSystem',
    args: [MovementStateComponent, TargetComponent,
        Entities, ProjectileDataComponent] as const,
    step(movementState, { target }, entities, projectileData) {
        if (!target) {
            return;
        }
        const targetEntity = entities.get(target);
        const targetMovement = targetEntity?.components.get(MovementStateComponent);

        if (!targetMovement) {
            return;
        }

        movementState.turnTo = firstOrderWithFallback(movementState.position, movementState.velocity,
            targetMovement.position, targetMovement.velocity, projectileData.shotSpeed)
    }
});

export const ProjectileCollisionEvent
    = new EcsEvent<Entity>('ProjectileCollision');

const ProjectileCollisionSystem = new System({
    name: 'ProjectileCollisionSystem',
    events: [CollisionEvent],
    args: [CollisionEvent, Entities, UUID, ProjectileDataComponent,
        Optional(OwnerComponent), Emit] as const,
    step(collision, entities, uuid, projectileData, owner, emit) {
        const other = entities.get(collision.other);
        if (!other) {
            return;
        }
        const otherOwner = other.components.get(OwnerComponent);
        if (collision.other === owner || otherOwner === owner) {
            return;
        }

        const otherShield = other.components.get(ShieldComponent);
        const otherArmor = other.components.get(ArmorComponent);
        const otherIonization = other.components.get(IonizationComponent);

        if (otherArmor) {
            applyDamage(projectileData.damage, otherArmor, otherShield, otherIonization);
        }
        const self = entities.get(uuid);
        if (!self) {
            console.warn(`Missing projectile ${uuid} that is colliding`);
            return;
        }
        entities.delete(uuid);
        emit(ProjectileCollisionEvent, self);
    }
});

export const ProjectilePlugin: Plugin = {
    name: 'ProjectilePlugin',
    build(world) {
        const weaponConstructors = world.resources.get(WeaponConstructors);
        if (!weaponConstructors) {
            throw new Error('Expected WeaponConstructors to exist');
        }
        weaponConstructors.set('ProjectileWeaponData', ProjectileWeaponEntry);

        world.addSystem(ProjectileGuidanceSystem);
        world.addSystem(ProjectileLifespanSystem);
        world.addSystem(ProjectileCollisionSystem);
    }
}
