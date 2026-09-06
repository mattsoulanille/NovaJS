import { ParticleConfig } from "novadatainterface/weapon_data";
import { Component } from "nova_ecs/component";
import { Plugin } from "nova_ecs/plugin";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { TimeResource, TimeSystem } from "nova_ecs/plugins/time_plugin";
import { Provide } from "nova_ecs/provide";
import { Resource } from "nova_ecs/resource";
import { System } from "nova_ecs/system";
import { SingletonComponent } from "nova_ecs/world";
import { AsteroidBreakEvent } from "../nova_plugin/combat/asteroid_plugin.js";
import { ProjectileCollisionEvent } from "../nova_plugin/combat/projectile_plugin.js";
import { ProjectileDataComponent } from "../nova_plugin/core/projectile_data.js";
import { GpuParticleSystem, PARTICLE_CAPACITY } from "./gpu_particles.js";
import {
    advanceEmission, BurstConfig, dustBurst, spawnBurst, spawnTrailSegment,
    TRAIL_EMIT_HZ, weaponBurst,
} from "./particle_effects.js";
import { CameraFocus, Space } from "./space_resource.js";
import { ZIndex } from "./z_index.js";

/**
 * Weapon trails, hit sparks and asteroid breakup dust, all drawn by one
 * GPU-resident particle system (see gpu_particles.ts).
 *
 * This plugin owns only the bridge from simulation events to birth
 * records: nothing here allocates per particle, and nothing steps a
 * particle. A projectile's trail is one small number per ENTITY (the
 * emission accumulator); a hit or a breakup is a single call that writes
 * N slots into the ring buffer. Particles outlive the entity that
 * emitted them for free, because they are just records in the ring with
 * a birth time — there is nothing to orphan and nothing to destroy.
 */

export const ParticleSystemResource =
    new Resource<GpuParticleSystem>('ParticleSystemResource');

/**
 * The wall-clock instant the particle clock counts from, captured on the
 * first frame. Birth times and the shader's `uTime` are seconds since
 * this instant because epoch milliseconds (~1.7e12) lose all sub-second
 * precision once they are narrowed to the float32 a uniform carries.
 */
const ParticleTimeOriginResource =
    new Resource<{ epochMs?: number }>('ParticleTimeOrigin');

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

/**
 * A projectile's trail state: its translated burst config, the fraction
 * of a particle it owed at the end of the last step, and where it was
 * then (so this step's particles can be laid along the segment it
 * actually covered). Three numbers and one shared config object per
 * projectile — the whole per-entity cost of a trail.
 */
interface TrailEmission {
    config: BurstConfig;
    /** Particles per second this projectile emits. */
    rate: number;
    accumulator: number;
    lastX: number;
    lastY: number;
}

const TrailEmissionComponent =
    new Component<TrailEmission>('TrailEmissionComponent');

const TrailEmissionProvider = Provide({
    name: "TrailEmissionProvider",
    provided: TrailEmissionComponent,
    args: [TrailParticlesComponent, MovementStateComponent] as const,
    factory(particleConfig, movementState): TrailEmission {
        return {
            config: weaponBurst(particleConfig),
            rate: particleConfig.count * TRAIL_EMIT_HZ,
            accumulator: 0,
            lastX: movementState.position.x,
            lastY: movementState.position.y,
        };
    }
});

/**
 * Advances the one uniform the whole system runs on. Time is the display
 * world's wall clock (the same clock every other display plugin renders
 * against, so a paused or hidden tab freezes particles exactly like it
 * freezes animations), rebased to seconds since the first frame: epoch
 * milliseconds do not survive the float32 trip to the GPU.
 */
const ParticleTimeSystem = new System({
    name: "ParticleTimeSystem",
    args: [ParticleSystemResource, ParticleTimeOriginResource, TimeResource,
        CameraFocus, SingletonComponent] as const,
    // So the clock this system reads is this frame's, not the last
    // frame's, no matter what order the plugins were added in.
    after: [TimeSystem],
    step(particles, origin, time, cameraFocus) {
        if (origin.epochMs === undefined) {
            origin.epochMs = time.time;
        }
        particles.update((time.time - origin.epochMs) / 1000,
            cameraFocus.x, cameraFocus.y);
    }
});

const TrailEmissionSystem = new System({
    name: "TrailEmissionSystem",
    args: [MovementStateComponent, TrailEmissionComponent,
        ParticleSystemResource, TimeResource] as const,
    // So this frame's particles are stamped with this frame's clock.
    after: [ParticleTimeSystem],
    step({ position }, trail, particles, time) {
        const { count, accumulator } = advanceEmission(
            trail.accumulator, trail.rate, time.delta_s);
        trail.accumulator = accumulator;
        if (count > 0) {
            spawnTrailSegment(particles, trail.config, count,
                trail.lastX, trail.lastY, position.x, position.y);
        }
        trail.lastX = position.x;
        trail.lastY = position.y;
    }
});

const HitParticlesSystem = new System({
    name: "HitParticlesSystem",
    events: [ProjectileCollisionEvent],
    args: [ProjectileCollisionEvent, ParticleSystemResource,
        SingletonComponent] as const,
    step(collision, particles) {
        const particleConfig = collision.projectileData.hitParticles;
        const position = collision.position;
        if (!particleConfig?.count || !position) {
            return;
        }
        spawnBurst(particles, weaponBurst(particleConfig),
            position.x, position.y);
    }
});

const AsteroidBreakParticlesSystem = new System({
    name: "AsteroidBreakParticlesSystem",
    events: [AsteroidBreakEvent],
    args: [AsteroidBreakEvent, ParticleSystemResource,
        SingletonComponent] as const,
    step(breakEvent, particles) {
        if (!breakEvent.particleCount) {
            return;
        }
        spawnBurst(particles, dustBurst(breakEvent),
            breakEvent.position.x, breakEvent.position.y);
    }
});

export const ParticlesPlugin: Plugin = {
    name: "ParticlesPlugin",
    build(world) {
        const space = world.resources.get(Space);
        if (!space) {
            throw new Error('Expected world to have Space resource');
        }

        const particles = new GpuParticleSystem(PARTICLE_CAPACITY);
        // One shared mesh for every particle effect, so it gets ONE
        // layer. Deliberately the backdrop layer (below ships, where it
        // has always been): engine trails belong under the hull that
        // emits them, and raising the whole mesh to put hit sparks over
        // ships would drag the trails up with them.
        particles.zIndex = ZIndex.BACKDROP;
        space.addChild(particles);
        world.resources.set(ParticleSystemResource, particles);
        world.resources.set(ParticleTimeOriginResource, {});

        // Test lever, matching the other window handles the game exposes
        // (novaSim, novaAutopilot, ...): live budget counters.
        if (typeof window !== 'undefined') {
            window.novaParticleStats = () => particles.stats();
        }

        world.addSystem(TrailParticlesProvider);
        world.addSystem(HitParticlesProvider);
        world.addSystem(TrailEmissionProvider);
        world.addSystem(ParticleTimeSystem);
        world.addSystem(TrailEmissionSystem);
        world.addSystem(HitParticlesSystem);
        world.addSystem(AsteroidBreakParticlesSystem);
    },
    remove(world) {
        world.removeSystem(TrailParticlesProvider);
        world.removeSystem(HitParticlesProvider);
        world.removeSystem(TrailEmissionProvider);
        world.removeSystem(ParticleTimeSystem);
        world.removeSystem(TrailEmissionSystem);
        world.removeSystem(HitParticlesSystem);
        world.removeSystem(AsteroidBreakParticlesSystem);

        const particles = world.resources.get(ParticleSystemResource);
        const space = world.resources.get(Space);
        if (particles) {
            space?.removeChild(particles);
            particles.destroy();
        }
        world.resources.delete(ParticleSystemResource);
        world.resources.delete(ParticleTimeOriginResource);
    }
};
