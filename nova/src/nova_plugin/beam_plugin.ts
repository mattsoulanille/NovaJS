import { BeamWeaponData } from 'novadatainterface/WeaponData';
import { Entities, UUID } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { EntityBuilder } from 'nova_ecs/entity';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { MovementStateComponent, MovementSystem } from 'nova_ecs/plugins/movement_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { System } from 'nova_ecs/system';
import * as SAT from "sat";
import { Hull, HullComponent, UpdateHullSystem } from './collisions_plugin';
import { applyDamage, CollisionEvent, CollisionInteractionComponent } from './collision_interaction';
import { applyExitPoint } from './exit_point';
import { FireTimeProvider } from './fire_time';
import { zeroOrderGuidance } from './guidance';
import { ArmorComponent, IonizationComponent, ShieldComponent } from './health_plugin';
import { TargetComponent } from './target_component';


export interface ExitPointData {
    position: [number, number, number],
    upCompress: [number, number],
    downCompress: [number, number],
}

interface BeamState {
    parent?: string, /* uuid of what is firing the beam */
    source?: string, /* uuid of the source for collisions */
    pointToTarget?: boolean,
    exitPointData?: ExitPointData,
}

export const BeamStateComponent = new Component<BeamState>('BeamState');
export const BeamDataComponent = new Component<BeamWeaponData>('BeamData');

export function makeBeam({
    beamData,
    position,
    rotation,
    source,
    parent,
    target,
    exitPointData,
}: {
    beamData: BeamWeaponData,
    position: Position,
    rotation: Angle,
    source?: string,
    parent?: string,
    target?: string,
    exitPointData?: ExitPointData,
}) {
    const { width, length } = beamData.beamAnimation;
    const beamPoly = new SAT.Polygon(new SAT.Vector(0, 0), [
        new SAT.Vector(-width / 2, 0),
        new SAT.Vector(-width / 2, -length),
        new SAT.Vector(width / 2, -length),
        new SAT.Vector(width / 2, 0),
    ]);

    const beam = new EntityBuilder()
        .setName(beamData.name)
        .addComponent(MovementStateComponent, {
            position,
            rotation,
            velocity: new Vector(0, 0),
            accelerating: 0,
            turnBack: false,
            turning: 0,
        }).addComponent(CollisionInteractionComponent, {
            hitTypes: new Set(['normal'])
        }).addComponent(HullComponent, {
            hulls: [new Hull([beamPoly])],
        }).addComponent(BeamStateComponent, {
            exitPointData, source, parent,
            pointToTarget: beamData.guidance === "beamTurret" ||
                beamData.guidance === "pointDefenseBeam",
        }).addComponent(BeamDataComponent, beamData);

    if (target) {
        beam.addComponent(TargetComponent, { target });
    }

    return beam;
}

export const BeamSystem = new System({
    name: 'BeamSystem',
    before: [UpdateHullSystem],
    after: [MovementSystem],
    args: [BeamDataComponent, BeamStateComponent, MovementStateComponent,
        FireTimeProvider, TimeResource, UUID, Entities,
        Optional(TargetComponent)] as const,
    step(beamData, beamState, movement, fireTime, { time }, uuid, entities, target) {

        const timeSinceFire = time - fireTime;
        if (timeSinceFire > beamData.shotDuration) {
            entities.delete(uuid);
        }

        if (beamState.parent) {
            const parent = entities.get(beamState.parent);
            const parentMovement = parent?.components
                .get(MovementStateComponent);
            if (parentMovement) {
                movement.position =
                    Position.fromVectorLike(parentMovement.position);
                movement.rotation =
                    Angle.fromAngleLike(parentMovement.rotation);

                if (beamState.exitPointData) {
                    const { position, upCompress, downCompress } =
                        beamState.exitPointData;
                    const exitPoint = applyExitPoint(position, parentMovement.rotation,
                        upCompress, downCompress);
                    movement.position = movement.position.add(exitPoint) as Position;
                }
            }
        }

        if (beamState.pointToTarget && target?.target) {
            const otherPos = entities.get(target.target)?.components
                .get(MovementStateComponent)?.position;
            if (otherPos) {
                movement.rotation = zeroOrderGuidance(movement.position, otherPos);
            }
        }
    }
});

const BeamCollisionSystem = new System({
    name: 'BeamCollisionSystem',
    events: [CollisionEvent],
    args: [CollisionEvent, Entities, BeamStateComponent,
        BeamDataComponent, FireTimeProvider, TimeResource] as const,
    step(collision, entities, beamState, beamData, fireTime,
        { time, delta_ms }) {

        const other = entities.get(collision.other);
        if (!other) {
            return;
        }
        if (collision.other === beamState.source) {
            return;
        }

        const otherShield = other.components.get(ShieldComponent);
        const otherArmor = other.components.get(ArmorComponent);
        const otherIonization = other.components.get(IonizationComponent);

        const timeSinceFire = time - fireTime;
        const lastTimeSinceFire = timeSinceFire - delta_ms;
        const damageTime = Math.min(delta_ms, beamData.shotDuration - lastTimeSinceFire);
        const scale = damageTime * 30 / 1000;

        if (otherArmor) {
            applyDamage(beamData.damage, otherArmor, otherShield, otherIonization, scale);
        }
    }
});

export const BeamPlugin: Plugin = {
    name: 'BeamPlugin',
    build(world) {
        world.addSystem(BeamSystem);
        world.addSystem(BeamCollisionSystem);
    }
};
