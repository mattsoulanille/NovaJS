import { ParticleConfig } from "novadatainterface/WeaponData";
import { GetEntity } from "nova_ecs/arg_types";
import { Component } from "nova_ecs/component";
import { DeleteEvent } from "nova_ecs/events";
import { Plugin } from "nova_ecs/plugin";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { Provide } from "nova_ecs/provider";
import { Resource } from "nova_ecs/resource";
import { System } from "nova_ecs/system";
import { SingletonComponent } from "nova_ecs/world";
import * as particles from "@pixi/particle-emitter";
import * as PIXI from "pixi.js";
import { ProjectileDataComponent } from "../nova_plugin/projectile_data";
import { ProjectileCollisionEvent } from "../nova_plugin/projectile_plugin";
import { PixiAppResource } from "./pixi_app_resource";
import { Space } from "./space_resource";


const ParticleContainerResource = new Resource<PIXI.Container>('ParticleContainerResource');
export const TrailParticlesComponent =
    new Component<ParticleConfig>('TrailParticlesComponent');

const TrailParticlesProvider = Provide({
    name: "TrailParticlesProvider",
    provided: TrailParticlesComponent,
    args: [ProjectileDataComponent] as const,
    factory(projectileData) {
        return projectileData.trailParticles;
    }
});

export const HitParticlesComponent =
    new Component<ParticleConfig>('HitParticlesComponent');

const HitParticlesProvider = Provide({
    name: "HitParticlesProvider",
    provided: HitParticlesComponent,
    args: [ProjectileDataComponent] as const,
    factory(projectileData) {
        return projectileData.hitParticles;
    }
});

const TrailEmitterComponent =
    new Component<particles.Emitter>('TrailEmitterComponent');

function makeEmitter(container: PIXI.Container, texture: PIXI.Texture,
    fps: number, particleConfig: ParticleConfig): particles.Emitter {
    return new particles.Emitter(container, particles.upgradeConfig({
        alpha: {
            start: 1,
            end: 0,
        },
        scale: {
            start: 1,
            end: 1,
            minimumScaleMultiplier: 1,
        },
        color: {
            start: particleConfig.color.toString(16),
            end: particleConfig.color.toString(16),
        },
        speed: {
            start: particleConfig.velocity / 2,
            end: particleConfig.velocity / 2,
            minimumSpeedMultiplier: 1,
        },
        acceleration: {
            x: 0,
            y: 0,
        },
        maxSpeed: 0,
        startRotation: {
            min: 0,
            max: 360
        },
        noRotation: true,
        rotationSpeed: {
            min: 0,
            max: 0,
        },
        lifetime: {
            min: particleConfig.lifeMin / 30,
            max: particleConfig.lifeMax / 30,
        },
        blendMode: "add",
        frequency: 1 / fps,
        emitterLifetime: -1,
        maxParticles: 1000,
        pos: {
            x: 0,
            y: 0
        },
        addAtBack: false,
        spawnType: "burst",
        particlesPerWave: particleConfig.count,
        particleSpacing: 0,
        angleStart: 0,
    }, [texture]));
}

const ParticleTextureResource = new Resource<PIXI.Texture>('ParticleTexture');
const TrailEmitterProvider = Provide({
    name: "TrailEmitterProvider",
    provided: TrailEmitterComponent,
    args: [TrailParticlesComponent, PixiAppResource,
        ParticleContainerResource, ParticleTextureResource] as const,
    factory(particleConfig, app, particleContainer, texture) {
        const emitter = makeEmitter(particleContainer, texture, app.ticker.FPS,
            particleConfig);
        emitter.emit = true;
        return emitter;
    }
});

// Particle emitters waiting to be destroyed
const OrphanParticleEmitters =
    new Resource<Map<particles.Emitter, number>>('OrphanParticleEmitters');

const OrphanEmittersSystem = new System({
    name: 'OrphanParticleEmittersSystem',
    args: [OrphanParticleEmitters, TimeResource, SingletonComponent] as const,
    step(emitters, time) {
        for (const [emitter, deleteTime] of emitters) {
            emitter.update(time.delta_s);
            if (time.time > deleteTime) {
                emitter.destroy();
                emitters.delete(emitter);
            }
        }
    }
});

const TrailEmitterCleanup = new System({
    name: 'TrailEmitterCleanup',
    events: [DeleteEvent],
    args: [TrailEmitterComponent, OrphanParticleEmitters, TimeResource, GetEntity] as const,
    step(emitter, orphanEmitters, time, entity) {
        emitter.emit = false;
        orphanEmitters.set(emitter, time.time + emitter.maxLifetime * 1000);
        entity.components.delete(TrailEmitterComponent);
    }
});

const TrailEmitterSystem = new System({
    name: "TrailEmitterSystem",
    args: [MovementStateComponent, TrailEmitterComponent, TimeResource] as const,
    step({ position }, emitter, time) {
        emitter.updateOwnerPos(position.x, position.y);
        emitter.update(time.delta_s);
    }
});

const HitEmitterSystem = new System({
    name: "HitEmitterSystem",
    events: [ProjectileCollisionEvent],
    args: [ProjectileDataComponent, MovementStateComponent, Space, ParticleTextureResource,
        OrphanParticleEmitters, TimeResource] as const,
    step(projectileData, movementState, space, texture, orphanEmitters, time) {
        const particleConfig = projectileData?.hitParticles;
        const position = movementState.position;
        if (!particleConfig || !position) {
            return;
        }
        const emitter = makeEmitter(space, texture, 1 /* fps */, particleConfig);

        emitter.updateOwnerPos(position.x, position.y);
        emitter.emit = true;
        // One single frame
        emitter.update(1)
        emitter.emit = false;
        orphanEmitters.set(emitter, time.time + emitter.maxLifetime * 1000);
    }
});

export const ParticlesPlugin: Plugin = {
    name: "ParticlesPlugin",
    build(world) {
        const app = world.resources.get(PixiAppResource);
        if (!app) {
            throw new Error('Expected world to have pixi app resource');
        }

        const graphics = new PIXI.Graphics();
        graphics.lineStyle(1, 0xFFFFFF, 1, 0);
        graphics.moveTo(0, 0);
        graphics.lineTo(1, 0);
        const texture = app.renderer.generateTexture(graphics);
        world.resources.set(ParticleTextureResource, texture);
        world.resources.set(OrphanParticleEmitters, new Map());

        const space = world.resources.get(Space);
        if (!space) {
            throw new Error('Expected world to have Space resource');
        }
        const particleContainer = new PIXI.ParticleContainer(20_000, {
            alpha: false,
            position: true,
            rotation: false,
            scale: false,
            tint: false,
            uvs: false,
            vertices: false,
        });
        particleContainer.autoResize = true;
        particleContainer.baseTexture = texture.baseTexture;

        space.addChild(particleContainer);
        world.resources.set(ParticleContainerResource, particleContainer);

        world.addSystem(TrailParticlesProvider);
        world.addSystem(HitParticlesProvider);
        world.addSystem(TrailEmitterProvider);
        world.addSystem(TrailEmitterSystem);
        world.addSystem(TrailEmitterCleanup);
        world.addSystem(OrphanEmittersSystem);
        world.addSystem(HitEmitterSystem);
    },
    remove(world) {
        world.removeSystem(TrailParticlesProvider);
        world.removeSystem(HitParticlesProvider);
        world.removeSystem(TrailEmitterProvider);
        world.removeSystem(TrailEmitterSystem);
        world.removeSystem(TrailEmitterCleanup);
        world.removeSystem(OrphanEmittersSystem);
        world.removeSystem(HitEmitterSystem);

        world.resources.delete(ParticleTextureResource);
        world.resources.delete(OrphanParticleEmitters);
    }
};
