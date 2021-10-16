import { BeamWeaponData, WeaponData } from 'novadatainterface/WeaponData';
import { Entities, RunQueryFunction, UUID } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity, EntityBuilder } from 'nova_ecs/entity';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { MovementState, MovementStateComponent, MovementSystem } from 'nova_ecs/plugins/movement_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { Query } from 'nova_ecs/query';
import { System } from 'nova_ecs/system';
import * as SAT from "sat";
import { v4 } from 'uuid';
import { Hull, HullComponent, UpdateHullSystem } from './collisions_plugin';
import { CollisionEvent, CollisionInteractionComponent } from './collision_interaction';
import { CreateTime } from './create_time';
import { ApplyDamageResource } from './death_plugin';
import { applyExitPoint, ExitPointData } from './exit_point';
import { FireSubs, OwnerComponent, sampleInaccuracy, SourceComponent, WeaponConstructors, WeaponEntry } from './fire_weapon_plugin';
import { zeroOrderGuidance } from './guidance';
import { SoundEvent } from './sound_event';
import { TargetComponent } from './target_component';
import { WeaponsSystem } from './weapon_plugin';


interface BeamState {
    pointToTarget?: boolean,
    exitPointData?: ExitPointData,
}

export const BeamStateComponent = new Component<BeamState>('BeamState');
export const BeamDataComponent = new Component<BeamWeaponData>('BeamData');

const BeamSubsQuery = new Query([MovementStateComponent] as const);

class BeamWeaponEntry extends WeaponEntry {
    declare data: BeamWeaponData;
    protected pointDefenseRangeSquared: number;

    private hitTypes: Set<string>;
    constructor(data: WeaponData, runQuery: RunQueryFunction) {
        if (data.type !== 'BeamWeaponData') {
            throw new Error('Data must be BeamWeaponData');
        }
        super(data, runQuery);
        this.pointDefenseRangeSquared = data.beamAnimation.length ** 2;

        this.hitTypes = new Set(['normal']);
        if (data.guidance === 'pointDefenseBeam') {
            this.hitTypes = new Set(['pointDefense']);
        }
    }

    protected guidance(exitPoint: Position, _movement: MovementState,
        targetMovement: MovementState) {
        return zeroOrderGuidance(exitPoint, targetMovement.position);
    }

    fire(position: Position, angle: Angle, owner?: string, target?: string,
        source?: string, _sourceVelocity?: Vector, exitPointData?: ExitPointData): Entity {
        const { width, length } = this.data.beamAnimation;
        const beamPoly = new SAT.Polygon(new SAT.Vector(0, 0), [
            new SAT.Vector(-width / 2, 0),
            new SAT.Vector(-width / 2, -length),
            new SAT.Vector(width / 2, -length),
            new SAT.Vector(width / 2, 0),
        ]);

        const beam = new EntityBuilder()
            .setName(this.data.name)
            .addComponent(MovementStateComponent, {
                position,
                rotation: angle,
                velocity: new Vector(0, 0),
                accelerating: 0,
                turnBack: false,
                turning: 0,
            }).addComponent(CollisionInteractionComponent, {
                hitTypes: this.hitTypes,
            }).addComponent(HullComponent, {
                hulls: [new Hull([beamPoly])],
            }).addComponent(BeamStateComponent, {
                exitPointData,
                pointToTarget: this.data.guidance === "beamTurret" ||
                    this.data.guidance === "pointDefenseBeam",
            }).addComponent(BeamDataComponent, this.data);

        if (target) {
            beam.addComponent(TargetComponent, { target });
        }

        if (owner) {
            beam.addComponent(OwnerComponent, owner);
        }
        if (source) {
            beam.addComponent(SourceComponent, source);
        }

        if (this.data.sound) {
            this.emit(SoundEvent, {
                id: this.data.sound,
                loop: this.data.loopSound,
            });
        }
        this.entities.set(v4(), beam);
        return beam;
    }

    fireSubs(source: string, sourceExpired = false) {
        const [{ position, rotation }] = this.runQuery(BeamSubsQuery, source)[0];
        const endOfBeam = position.add(rotation.getUnitVector()
            .scale(this.data.beamAnimation.length)) as Position;
        return super.fireSubs(source, sourceExpired, endOfBeam);
    }
}

export const BeamSystem = new System({
    name: 'BeamSystem',
    before: [UpdateHullSystem],
    after: [MovementSystem, WeaponsSystem],
    args: [BeamDataComponent, BeamStateComponent, MovementStateComponent, FireSubs,
        CreateTime, TimeResource, UUID, Entities, Optional(SourceComponent),
        Optional(TargetComponent)] as const,
    step(beamData, beamState, movement, fireSubs, fireTime, { time }, uuid,
        entities, source, target) {
        const timeSinceFire = time - fireTime;
        if (timeSinceFire > beamData.shotDuration) {
            fireSubs(beamData.id, uuid, true);
            entities.delete(uuid);
        }

        if (source) {
            const parent = entities.get(source);
            const parentMovement = parent?.components
                .get(MovementStateComponent);
            if (parentMovement) {
                movement.position =
                    Position.fromVectorLike(parentMovement.position);
                movement.rotation =
                    Angle.fromAngleLike(parentMovement.rotation);

                if (beamState.exitPointData) {
                    const exitPoint = applyExitPoint(beamState.exitPointData,
                        parentMovement.rotation)

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
        movement.rotation = movement.rotation.add(sampleInaccuracy(beamData.accuracy));
    }
});

const BeamCollisionSystem = new System({
    name: 'BeamCollisionSystem',
    events: [CollisionEvent],
    args: [CollisionEvent, Entities, Optional(OwnerComponent),
        BeamDataComponent, CreateTime, ApplyDamageResource, TimeResource] as const,
    step(collision, entities, owner, beamData, fireTime, applyDamage,
        { time, delta_ms }) {

        const other = entities.get(collision.other);
        if (!other) {
            return;
        }
        const otherOwner = other.components.get(OwnerComponent);
        if (collision.other === owner || otherOwner === owner) {
            return;
        }

        const timeSinceFire = time - fireTime;
        const lastTimeSinceFire = timeSinceFire - delta_ms;
        const damageTime = Math.min(delta_ms, beamData.shotDuration - lastTimeSinceFire);
        const scale = damageTime * 30 / 1000;

        applyDamage(beamData.damage, collision.other, scale);
    }
});

export const BeamPlugin: Plugin = {
    name: 'BeamPlugin',
    build(world) {
        const weaponConstructors = world.resources.get(WeaponConstructors);
        if (!weaponConstructors) {
            throw new Error('Expected WeaponConstructors to exist');
        }
        weaponConstructors.set('BeamWeaponData', BeamWeaponEntry);

        world.addSystem(BeamSystem);
        world.addSystem(BeamCollisionSystem);
    }
};
