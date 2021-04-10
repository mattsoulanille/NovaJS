import { ProjectileWeaponData } from 'novadatainterface/WeaponData';
import { Entities, UUID } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { EntityBuilder } from 'nova_ecs/entity';
import { Plugin } from 'nova_ecs/plugin';
import { MovementPhysicsComponent, MovementStateComponent, MovementType } from 'nova_ecs/plugins/movement_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { Provide } from 'nova_ecs/provider';
import { System } from 'nova_ecs/system';
import { Guidance, zeroOrderGuidance } from './guidance';


export interface ProjectileType {
    id: string,
    source?: string,
}

export const ProjectileComponent = new Component<ProjectileType>('Projectile');
export const TargetComponent = new Component<{ target: string }>('TargetComponent');

export const ProjectileDataComponent = new Component<ProjectileWeaponData>('ProjectileData');

export const GuidanceComponent = new Component<{
    guidance: Guidance
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
    // TODO: Fix this in novaparse
    const realSpeed = projectileData.physics.speed * 3 / 10;
    const velocity = sourceVelocity.add(
        rotation.getUnitVector().scale(realSpeed));
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
            acceleration: projectileData.physics.acceleration,
            maxVelocity: projectileData.guidance === 'rocket' ?
                realSpeed : Infinity,
            turnRate: projectileData.physics.turnRate,
            movementType: projectileData.guidance === 'guided'
                ? MovementType.INERTIALESS : MovementType.INERTIAL,
        });

    if (target) {
        projectile.addComponent(TargetComponent, { target });
    }
    if (projectileData.guidance === 'guided') {
        // TODO: Support 1st order approximation
        projectile.addComponent(GuidanceComponent, {
            guidance: Guidance.zeroOrder
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

const ProjectileLifespanSystem = new System({
    name: 'ProjectileLifespanSystem',
    args: [ProjectileFireTimeProvider, TimeResource,
        ProjectileDataComponent, Entities, UUID] as const,
    step(fireTime, { time }, { shotDuration }, entities, uuid) {
        // TODO: Fix shotDuration to be in ms
        const duration = shotDuration * 1000 / 30;
        if (time - fireTime > duration) {
            entities.delete(uuid);
        }
    },
});

const ProjectileGuidanceSystem = new System({
    name: 'ProjectileGuidanceSystem',
    args: [MovementStateComponent, TargetComponent,
        Entities, ProjectileComponent] as const,
    step(movementState, { target }, entities) {
        const targetEntity = entities.get(target);
        const targetMovement = targetEntity?.components.get(MovementStateComponent);
        const targetPosition = targetMovement?.position;

        if (!targetPosition) {
            return;
        }

        const position = movementState.position;
        movementState.turnToAngle = zeroOrderGuidance(position, targetPosition);
    }
});

export const ProjectilePlugin: Plugin = {
    name: 'ProjectilePlugin',
    build(world) {
        world.addSystem(ProjectileGuidanceSystem);
        world.addSystem(ProjectileLifespanSystem);
    }
}