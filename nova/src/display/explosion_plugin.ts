import { ExplosionData } from "novadatainterface/ExplosionData";
import { Emit, Entities, UUID } from "nova_ecs/arg_types";
import { Component } from "nova_ecs/component";
import { Angle } from "nova_ecs/datatypes/angle";
import { Position } from "nova_ecs/datatypes/position";
import { Vector } from "nova_ecs/datatypes/vector";
import { EntityBuilder } from "nova_ecs/entity";
import { Optional } from "nova_ecs/optional";
import { Plugin } from "nova_ecs/plugin";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { System } from "nova_ecs/system";
import { SingletonComponent } from "nova_ecs/world";
import { v4 } from "uuid";
import { ExplosionDataComponent } from "../nova_plugin/animation_plugin";
import { GameDataResource } from "../nova_plugin/game_data_resource";
import { ProjectileDataComponent } from "../nova_plugin/projectile_data";
import { ProjectileCollisionEvent, ProjectileExpireEvent } from "../nova_plugin/projectile_plugin";
import { SoundEvent } from "../nova_plugin/sound_event";
import { AnimationGraphicComponent } from "./animation_graphic_plugin";


const ExplosionState = new Component<{
    startTime?: number,
    lifetime?: number,
}>('ExplosionState');

const ExplosionSystem = new System({
    name: 'ExplosionSystem',
    args: [AnimationGraphicComponent, ExplosionDataComponent,
        ExplosionState, TimeResource, Entities, UUID, Emit] as const,
    step(graphic, explosionData, explosionState, time, entities, uuid, emit) {
        if (!explosionState.startTime || !explosionState.lifetime) {
            explosionState.startTime = time.time;
            const frameTime = 30 / explosionData.rate;
            explosionState.lifetime = frameTime * Math.max(0,
                ...[...graphic.sprites.values()].map(s => s.frames));

            if (explosionData.sound) {
                emit(SoundEvent, { id: explosionData.sound })
            }
        }

        const progress = (time.time - explosionState.startTime)
            / explosionState.lifetime;
        graphic.progress = progress;

        if (progress > 1) {
            entities.delete(uuid);
        }
    }
});

const SecondaryExplosionComponent = new Component<{
    explosion: ExplosionData,
    lastTime?: number,
    period: number,
}>('SecondaryExplosion');



function randomPointInCircle(r: number): Vector {
    const r2 = r ** 2;
    while (true) {
        const pos = new Position(
            (Math.random() - 0.5) * 2 * r,
            (Math.random() - 0.5) * 2 * r,
        );
        if (pos.lengthSquared <= r2) {
            return pos;
        }
    }
}

const SecondaryExplosionSystem = new System({
    name: 'SecondaryExplosion',
    args: [SecondaryExplosionComponent, TimeResource, Entities,
        MovementStateComponent] as const,
    step(explosion, time, entities, { position }) {
        if (!explosion.lastTime) {
            explosion.lastTime = 0;
        }
        if (explosion.lastTime + explosion.period > time.time) {
            return;
        }

        explosion.lastTime = time.time;

        // TODO: Fix these types in position.ts
        const pos = position.add(randomPointInCircle(80)) as Position;
        entities.set(v4(), makeExplosion(explosion.explosion, pos));
    }
});

const ProjectileExplosionSystem = new System({
    name: 'ProjectileExplosionSystem',
    events: [ProjectileExpireEvent, ProjectileCollisionEvent],
    args: [Optional(ProjectileExpireEvent), Optional(ProjectileCollisionEvent),
        GameDataResource, Entities, SingletonComponent] as const,
    step(expire, collide, gameData, entities) {
        const projectile = expire ?? collide;
        const projectileData = projectile?.components.get(ProjectileDataComponent);
        const movement = projectile?.components.get(MovementStateComponent);
        if (!projectileData || !movement) {
            return;
        }

        const primary = projectileData.primaryExplosion;
        if (!primary) {
            return;
        }

        const primaryExplosionData = gameData.data.Explosion.getCached(primary);
        if (!primaryExplosionData) {
            return;
        }

        const secondary = projectileData.secondaryExplosion;
        let secondaryExplosionData: ExplosionData | undefined;
        if (secondary) {
            secondaryExplosionData =
                gameData.data.Explosion.getCached(secondary);
        }

        entities.set(v4(), makeExplosion(primaryExplosionData,
            movement.position, secondaryExplosionData));
    }
});

export function makeExplosion(explosionData: ExplosionData, position: Position,
    secondaryExplosionData?: ExplosionData) {
    const explosion = new EntityBuilder()
        .addComponent(ExplosionDataComponent, explosionData)
        .addComponent(ExplosionState, {})
        .addComponent(MovementStateComponent, {
            position,
            accelerating: 0,
            rotation: new Angle(0),
            turnBack: false,
            turning: 0,
            velocity: new Vector(0, 0),
        });
    if (secondaryExplosionData) {
        explosion.addComponent(SecondaryExplosionComponent, {
            explosion: secondaryExplosionData,
            period: 30,
        });
    }
    return explosion;
}

export const ExplosionPlugin: Plugin = {
    name: 'ExplosionPlugin',
    build(world) {
        world.addSystem(ExplosionSystem);
        world.addSystem(ProjectileExplosionSystem);
        world.addSystem(SecondaryExplosionSystem);
    },
    remove(world) {
        world.removeSystem(ExplosionSystem);
        world.removeSystem(ProjectileExplosionSystem);
        world.removeSystem(SecondaryExplosionSystem);
    }
}
