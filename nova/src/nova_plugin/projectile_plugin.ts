import { GameDataInterface } from 'novadatainterface/GameDataInterface';
import { ProjectileWeaponData } from 'novadatainterface/WeaponData';
import { Entities, UUID } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { EntityBuilder } from 'nova_ecs/entity';
import { EntityMap } from 'nova_ecs/entity_map';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { MovementPhysicsComponent, MovementState, MovementStateComponent, MovementType } from 'nova_ecs/plugins/movement_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { Provide } from 'nova_ecs/provider';
import { System } from 'nova_ecs/system';
import { v4 } from 'uuid';
import { CollisionEvent, CollisionInteractionComponent } from './collision_interaction';
import { GameDataResource } from './game_data_resource';
import { firstOrderWithFallback, Guidance, zeroOrderGuidance } from './guidance';
import { ArmorComponent, IonizationComponent, ShieldComponent } from './health_plugin';
import { Stat } from './stat';
import { Target, TargetComponent } from './target_component';


export interface ProjectileType {
    id: string,
    source?: string,
}

export const ProjectileComponent = new Component<ProjectileType>('Projectile');

export const ProjectileDataComponent = new Component<ProjectileWeaponData>('ProjectileData');

export const GuidanceComponent = new Component<{
    guidance: Guidance,
}>('GuidanceComponent');

export function makeProjectile({
    projectileData, position, rotation,
    sourceVelocity = new Vector(0, 0),
    source, target,
}: {
    projectileData: ProjectileWeaponData,
    position: Position,
    rotation: Angle,
    sourceVelocity?: Vector,
    source?: string,
    target?: string,
}) {
    let velocity = new Vector(0, 0);
    if (projectileData.guidance !== 'guided') {
        velocity = velocity.add(sourceVelocity);
    }
    if (projectileData.guidance !== 'rocket') {
        velocity = velocity.add(rotation.getUnitVector()
            .scale(projectileData.physics.speed));
    }

    const projectile = new EntityBuilder()
        .setName(projectileData.name)
        .addComponent(ProjectileDataComponent, projectileData)
        .addComponent(ProjectileComponent, {
            id: projectileData.id,
            source
        }).addComponent(MovementStateComponent, {
            position, rotation, velocity,
            accelerating: projectileData.guidance === 'rocket' ? 1 : 0,
            turning: 0,
            turnBack: false,
        }).addComponent(MovementPhysicsComponent, {
            acceleration: projectileData.physics.acceleration || 1200,
            maxVelocity: projectileData.guidance === 'rocket' ?
                projectileData.physics.speed : Infinity,
            turnRate: projectileData.physics.turnRate,
            movementType: projectileData.guidance === 'guided'
                ? MovementType.INERTIALESS : MovementType.INERTIAL,
        }).addComponent(CollisionInteractionComponent, {
            hitTypes: new Set(['normal']),
        });

    if (target) {
        projectile.addComponent(TargetComponent, { target });
    }
    if (projectileData.guidance === 'guided') {
        projectile.addComponent(GuidanceComponent, {
            guidance: Guidance.firstOrder
        });
    }

    return projectile.build();
}

const ProjectileFireTime = new Component<number>('ProjectileFireTime');
const ProjectileFireTimeProvider = Provide({
    provided: ProjectileFireTime,
    args: [TimeResource] as const,
    factory({ time }) {
        return time;
    }
});

function* getEvenlySpacedAngles(angle: number) {
    let current = new Angle(0);
    yield current;
    while (true) {
        current = current.add(angle);
        yield current;
        yield new Angle(-current.angle);
    }
}

function* getRandomInCone(angle: number) {
    while (true) {
        yield new Angle((2 * Math.random() - 1) * angle);
    }
}

function fireSubs(sourceMovement: MovementState, entities: EntityMap,
    projectileData: ProjectileWeaponData, projectileType: ProjectileType,
    gameData: GameDataInterface, sourceExpired: boolean, target?: Target) {

    for (const sub of projectileData.submunitions) {
        const angles = sub.theta < 0
            ? getEvenlySpacedAngles(Math.abs(sub.theta))
            : getRandomInCone(sub.theta);

        for (let i = 0; i < sub.count; i++) {
            if (!sub.subIfExpire && sourceExpired) {
                continue;
            }
            const subWeapon = gameData.data.Weapon.getCached(sub.id);
            const angle = angles.next().value || new Angle(0);

            if (subWeapon?.type === 'ProjectileWeaponData') {
                const subInstance = makeProjectile({
                    projectileData: subWeapon,
                    position: sourceMovement.position,
                    rotation: sourceMovement.rotation.add(angle),
                    source: projectileType.source,
                    sourceVelocity: sourceMovement.velocity,
                    target: target?.target,
                });

                entities.set(v4(), subInstance);
            }
        }
    }
}

const ProjectileLifespanSystem = new System({
    name: 'ProjectileLifespanSystem',
    args: [ProjectileFireTimeProvider, TimeResource, MovementStateComponent,
        GameDataResource, Optional(TargetComponent), ProjectileDataComponent,
        ProjectileComponent, Entities, UUID] as const,
    step(fireTime, { time }, movement, gameData, target, projectileData,
        projectileType, entities, uuid) {
        if (time - fireTime > projectileData.shotDuration) {
            fireSubs(movement, entities, projectileData, projectileType,
                gameData, true /* source shot expired */, target);
            entities.delete(uuid);
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

function applyDamage(projectileData: ProjectileWeaponData, armor: Stat,
    shield?: Stat, ionization?: Stat) {

    if (projectileData.damage.ionization !== 0 && ionization) {
        ionization.current += projectileData.damage.ionization;
    }

    if (shield) {
        const minShield = -shield.max * 0.05;
        shield.current = Math.max(minShield,
            shield.current - projectileData.damage.shield);
        if (shield.current > 0) {
            return;
        }
    }

    armor.current = Math.max(0, armor.current - projectileData.damage.armor)
}

const ProjectileCollisionSystem = new System({
    name: 'ProjectileCollisionSystem',
    events: [CollisionEvent],
    args: [CollisionEvent, Entities, UUID, ProjectileDataComponent,
        ProjectileComponent] as const,
    step(collision, entities, uuid, projectileData, projectileComponent) {
        const other = entities.get(collision.other);
        if (!other) {
            return;
        }
        if (collision.other === projectileComponent.source) {
            return;
        }

        const otherShield = other.components.get(ShieldComponent);
        const otherArmor = other.components.get(ArmorComponent);
        const otherIonization = other.components.get(IonizationComponent);

        if (otherArmor) {
            applyDamage(projectileData, otherArmor, otherShield, otherIonization);
        }
        entities.delete(uuid);
    }
});

export const ProjectilePlugin: Plugin = {
    name: 'ProjectilePlugin',
    build(world) {
        world.addSystem(ProjectileGuidanceSystem);
        world.addSystem(ProjectileLifespanSystem);
        world.addSystem(ProjectileCollisionSystem);
    }
}
