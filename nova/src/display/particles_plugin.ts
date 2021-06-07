import { System } from "nova_ecs/system";
import { Plugin } from "nova_ecs/plugin";
import { Component } from "nova_ecs/component";
import * as particles from "pixi-particles";
import { ParticleConfig } from "novadatainterface/WeaponData";
import { Resource } from "nova_ecs/resource";
import { Provide } from "nova_ecs/provider";
import { Space } from "./space_resource";
import * as PIXI from "pixi.js";
import { PixiAppResource } from "./pixi_app_resource";
import { DeleteEvent } from "nova_ecs/events";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { ProjectileDataComponent } from "../nova_plugin/projectile_plugin";
import { FirstAvailable } from "nova_ecs/first_available";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { SingletonComponent } from "nova_ecs/world";


export const TrailParticlesComponent =
    new Component<ParticleConfig>('TrailParticlesComponent');

// export const HitParticlesComponent =
//     new Component<ParticleConfig>('HitParticlesComponent');

const ParticleEmitterComponent =
    new Component<particles.Emitter>('ParticleEmitterComponent');

const TrailParticlesProvider = Provide({
    provided: TrailParticlesComponent,
    args: [ProjectileDataComponent] as const,
    factory(projectileData) {
        return projectileData.trailParticles;
    }
});

const FirstTrailParticles = FirstAvailable([
    TrailParticlesComponent,
    TrailParticlesProvider,
]);

const ParticleTextureResource = new Resource<PIXI.Texture>('ParticleTexture');
const ParticleEmitterProvider = Provide({
    provided: ParticleEmitterComponent,
    args: [FirstTrailParticles, PixiAppResource,
        Space, ParticleTextureResource] as const,
    factory(particleConfig, app, space, texture) {
        const emitter = new particles.Emitter(space, [texture], {
            alpha: {
                start: 1,
                end: 0,
            },
            scale: {
                start: 0.1,
                end: 0.1,
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
            frequency: 1 / app.ticker.FPS,
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
            angleStart: 0
        });
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

const ParticleEmitterCleanup = new System({
    name: 'ParticleEmitterCleanup',
    events: [DeleteEvent],
    args: [ParticleEmitterComponent, OrphanParticleEmitters, TimeResource] as const,
    step(emitter, orphanEmitters, time) {
        emitter.emit = false;
        orphanEmitters.set(emitter, time.time + emitter.maxLifetime * 1000);
    }
});

const ParticlesSystem = new System({
    name: "ParticlesSystem",
    args: [MovementStateComponent, ParticleEmitterProvider, TimeResource] as const,
    step({ position }, emitter, time) {
        emitter.updateOwnerPos(position.x, position.y);
        emitter.update(time.delta_s);
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
        graphics.lineStyle(10, 0xFFFFFF);
        graphics.moveTo(0, 0);
        graphics.lineTo(10, 0);
        const texture = app.renderer.generateTexture(graphics);
        world.resources.set(ParticleTextureResource, texture);
        world.resources.set(OrphanParticleEmitters, new Map());

        world.addSystem(ParticlesSystem);
        world.addSystem(ParticleEmitterCleanup);
        world.addSystem(OrphanEmittersSystem);
    }
};
