import 'jasmine';
import { ParticleConfig } from 'novadatainterface/weapon_data';
import {
    FRAMES_PER_SECOND, PARTICLE_BLOCK_SIZE, PARTICLE_STRIDE_BYTES,
    ParticleBudget, ParticleRing, ParticleSpawn,
} from './gpu_particles.js';
import {
    advanceEmission, BurstConfig, dustBurst, MAX_TRAIL_PARTICLES_PER_STEP,
    PARTICLE_VELOCITY_SCALE, SPARK_HALF_SIZE, spawnBurst, spawnTrailSegment,
    TRAIL_EMIT_HZ, weaponBurst,
} from './particle_effects.js';

const FLOATS_PER_PARTICLE = PARTICLE_STRIDE_BYTES / 4;

function spawnRecord(over: Partial<ParticleSpawn> = {}): ParticleSpawn {
    return {
        x: 1, y: 2, vx: 3, vy: 4, life: 5, size0: 1, size1: 1,
        speedRatio: 1, color: 0x112233, alpha: 1, additive: true,
        ...over,
    };
}

/** Reads back the (x, y) written into a slot. */
function slotPosition(ring: ParticleRing, slot: number) {
    const f = slot * FLOATS_PER_PARTICLE;
    return { x: ring.floats[f], y: ring.floats[f + 1] };
}

/** Reads back the (birth, life) written into a slot. */
function slotTime(ring: ParticleRing, slot: number) {
    const f = slot * FLOATS_PER_PARTICLE;
    return { birth: ring.floats[f + 4], life: ring.floats[f + 5] };
}

describe('ParticleRing', () => {
    it('hands out consecutive slots', () => {
        const ring = new ParticleRing(4);
        expect(ring.spawn(spawnRecord(), 0)).toEqual(0);
        expect(ring.spawn(spawnRecord(), 0)).toEqual(1);
        expect(ring.spawn(spawnRecord(), 0)).toEqual(2);
        expect(ring.nextSlot).toEqual(3);
    });

    it('wraps back to slot 0 when it reaches capacity', () => {
        const ring = new ParticleRing(3);
        expect(ring.spawn(spawnRecord(), 0)).toEqual(0);
        expect(ring.spawn(spawnRecord(), 0)).toEqual(1);
        expect(ring.spawn(spawnRecord(), 0)).toEqual(2);
        expect(ring.spawn(spawnRecord(), 0)).toEqual(0);
        expect(ring.nextSlot).toEqual(1);
    });

    it('overwrites the oldest particle when over budget', () => {
        const ring = new ParticleRing(2);
        ring.spawn(spawnRecord({ x: 10, y: 11 }), 0);
        ring.spawn(spawnRecord({ x: 20, y: 21 }), 0);
        // Third spawn is over budget: it lands on the oldest slot.
        ring.spawn(spawnRecord({ x: 30, y: 31 }), 0);
        expect(slotPosition(ring, 0)).toEqual({ x: 30, y: 31 });
        expect(slotPosition(ring, 1)).toEqual({ x: 20, y: 21 });
    });

    it('counts total spawns and overwrites', () => {
        const ring = new ParticleRing(2);
        expect(ring.totalSpawned).toEqual(0);
        expect(ring.overwritten).toEqual(0);
        ring.spawn(spawnRecord(), 0);
        ring.spawn(spawnRecord(), 0);
        expect(ring.overwritten).toEqual(0);
        ring.spawn(spawnRecord(), 0);
        ring.spawn(spawnRecord(), 0);
        expect(ring.totalSpawned).toEqual(4);
        expect(ring.overwritten).toEqual(2);
    });

    it('stamps the birth time and lifetime it is given', () => {
        const ring = new ParticleRing(2);
        ring.spawn(spawnRecord({ life: 1.25 }), 7.5);
        expect(slotTime(ring, 0)).toEqual({ birth: 7.5, life: 1.25 });
    });

    it('packs the color and birth alpha into four bytes', () => {
        const ring = new ParticleRing(1);
        ring.spawn(spawnRecord({ color: 0xff8040, alpha: 0.5 }), 0);
        const b = PARTICLE_STRIDE_BYTES - 4;
        expect(ring.bytes[b]).toEqual(0xff);
        expect(ring.bytes[b + 1]).toEqual(0x80);
        expect(ring.bytes[b + 2]).toEqual(0x40);
        expect(ring.bytes[b + 3]).toEqual(128);
    });

    it('reports no dirty range before anything is written', () => {
        const ring = new ParticleRing(8);
        expect(ring.dirty).toBeFalse();
        expect(ring.takeDirtyRange()).toBeNull();
    });

    it('reports the contiguous range written since the last upload', () => {
        const ring = new ParticleRing(8);
        ring.spawn(spawnRecord(), 0);
        ring.spawn(spawnRecord(), 0);
        ring.spawn(spawnRecord(), 0);
        expect(ring.dirty).toBeTrue();
        expect(ring.takeDirtyRange()).toEqual({ start: 0, count: 3 });
        // Taking the range clears it.
        expect(ring.dirty).toBeFalse();
        expect(ring.takeDirtyRange()).toBeNull();
        ring.spawn(spawnRecord(), 0);
        expect(ring.takeDirtyRange()).toEqual({ start: 3, count: 1 });
    });

    it('covers both pieces when a batch of spawns wraps', () => {
        const ring = new ParticleRing(4);
        ring.spawn(spawnRecord(), 0);
        ring.spawn(spawnRecord(), 0);
        ring.spawn(spawnRecord(), 0);
        ring.takeDirtyRange();
        // Slot 3 then slot 0: the union spans the whole ring.
        ring.spawn(spawnRecord(), 0);
        ring.spawn(spawnRecord(), 0);
        expect(ring.takeDirtyRange()).toEqual({ start: 0, count: 4 });
    });
});

/**
 * The budget half of GpuParticleSystem: which blocks are worth drawing.
 *
 * Exercised through ParticleBudget rather than GpuParticleSystem itself
 * because the latter's constructor calls PIXI.Shader.from, which reaches
 * for a canvas to probe the GL precision and throws under node. The
 * display object owns one of these and does nothing else with the
 * expiry table: `spawn` and `stats` forward to it verbatim, and `update`
 * only assigns `time` (plus the shader uniforms).
 */
describe('ParticleBudget', () => {
    // Three blocks rather than the shipped 32: the draw-culling rules
    // are per block, so the smallest ring that can wrap exercises them.
    const CAPACITY = PARTICLE_BLOCK_SIZE * 3;

    /** Spawns `count` particles of lifetime `life` at the current clock. */
    function fill(system: ParticleBudget, count: number, life: number) {
        for (let i = 0; i < count; i++) {
            system.spawn(spawnRecord({ life }));
        }
    }

    it('draws nothing before anything has spawned', () => {
        const system = new ParticleBudget(CAPACITY);
        system.time = 0;
        expect(system.stats().liveBlocks).toEqual(0);
        expect(system.stats().drawnInstances).toEqual(0);
    });

    it('lights up one more block per block the spawns reach into', () => {
        const system = new ParticleBudget(CAPACITY);
        system.time = 0;

        fill(system, 1, 10);
        expect(system.stats().liveBlocks).toEqual(1);

        // Up to the last slot of block 0: still one block.
        fill(system, PARTICLE_BLOCK_SIZE - 1, 10);
        expect(system.stats().liveBlocks).toEqual(1);

        // One slot into block 1.
        fill(system, 1, 10);
        expect(system.stats().liveBlocks).toEqual(2);
    });

    it('draws a whole block per live block', () => {
        const system = new ParticleBudget(CAPACITY);
        system.time = 0;
        fill(system, PARTICLE_BLOCK_SIZE + 1, 10);
        const stats = system.stats();
        expect(stats.liveBlocks).toEqual(2);
        expect(stats.drawnInstances).toEqual(stats.liveBlocks * PARTICLE_BLOCK_SIZE);
        expect(stats.drawnInstances).toEqual(2 * PARTICLE_BLOCK_SIZE);
    });

    it('stops drawing once every particle has expired', () => {
        const system = new ParticleBudget(CAPACITY);
        system.time = 0;
        fill(system, PARTICLE_BLOCK_SIZE + 1, 1);
        expect(system.stats().liveBlocks).toEqual(2);

        // Still inside the lifetime.
        system.time = 0.9;
        expect(system.stats().liveBlocks).toEqual(2);

        system.time = 1.5;
        expect(system.stats().liveBlocks).toEqual(0);
        expect(system.stats().drawnInstances).toEqual(0);
    });

    it('keeps a block alive for its longest-lived particle', () => {
        const system = new ParticleBudget(CAPACITY);
        system.time = 0;
        // The long-lived one is not the last written, so this is the
        // `death > blockExpiry[block]` maximum rule and not "latest wins".
        fill(system, 1, 10);
        fill(system, 3, 0.5);
        system.time = 1;
        expect(system.stats().liveBlocks).toEqual(1);
        system.time = 11;
        expect(system.stats().liveBlocks).toEqual(0);
    });

    it('resets a block`s expiry when the ring wraps back onto its slot 0', () => {
        const system = new ParticleBudget(CAPACITY);
        system.time = 0;
        // Fill the whole ring with long-lived particles, leaving the
        // cursor back at slot 0.
        fill(system, CAPACITY, 1000);
        expect(system.stats().nextSlot).toEqual(0);
        expect(system.stats().liveBlocks).toEqual(3);

        // One short-lived particle lands on block 0's slot 0. That
        // starts a fresh pass, so block 0's expiry RESTARTS from this
        // particle rather than keeping the old pass's 1000 — the
        // designed budget-overrun degradation: once spawning outruns
        // capacity, the particles being overwritten stop being drawn.
        system.time = 10;
        system.spawn(spawnRecord({ life: 1 }));
        expect(system.stats().overwritten).toEqual(1);

        // At t = 11.5 block 0 is dark even though its (overwritten)
        // original particles would still have had ~989s to live; the
        // other two blocks are untouched.
        system.time = 11.5;
        const stats = system.stats();
        expect(stats.liveBlocks).toEqual(2);
        expect(stats.drawnInstances).toEqual(2 * PARTICLE_BLOCK_SIZE);
    });

    it('only resets on slot 0, not on every overwrite', () => {
        const system = new ParticleBudget(CAPACITY);
        system.time = 0;
        fill(system, CAPACITY, 1000);

        // Wrap onto slot 0 (reset to death 11), then onto slot 1 with a
        // shorter life: the maximum rule keeps the block's expiry at 11.
        system.time = 10;
        system.spawn(spawnRecord({ life: 1 }));
        system.spawn(spawnRecord({ life: 0.5 }));

        system.time = 10.9;
        expect(system.stats().liveBlocks).toEqual(3);
        system.time = 11.5;
        expect(system.stats().liveBlocks).toEqual(2);
    });

    it('coalesces contiguous live blocks into minimal draw runs', () => {
        const system = new ParticleBudget(PARTICLE_BLOCK_SIZE * 4);
        system.time = 0;
        expect(system.liveBlockRuns()).toEqual([]);

        // All 4 blocks live -> 1 single coalesced draw run covering all slots.
        fill(system, PARTICLE_BLOCK_SIZE * 4, 10);
        expect(system.liveBlockRuns()).toEqual([
            { startBlock: 0, blockCount: 4, instances: PARTICLE_BLOCK_SIZE * 4 },
        ]);

        // Expire block 1 only (leaving block 0 and blocks 2..3 live) -> 2 runs.
        system.time = 1;
        // Overwrite block 0 with long life, block 1 with short life.
        fill(system, PARTICLE_BLOCK_SIZE, 20);
        fill(system, PARTICLE_BLOCK_SIZE, 1);
        system.time = 3;
        expect(system.liveBlockRuns()).toEqual([
            { startBlock: 0, blockCount: 1, instances: PARTICLE_BLOCK_SIZE },
            { startBlock: 2, blockCount: 2, instances: PARTICLE_BLOCK_SIZE * 2 },
        ]);
    });
});

describe('advanceEmission', () => {
    it('emits nothing until a whole particle is owed', () => {
        const first = advanceEmission(0, 60, 1 / 120);
        expect(first.count).toEqual(0);
        expect(first.accumulator).toBeCloseTo(0.5, 10);
    });

    it('carries the fraction into the next step', () => {
        const first = advanceEmission(0, 60, 1 / 120);
        const second = advanceEmission(first.accumulator, 60, 1 / 120);
        expect(second.count).toEqual(1);
        expect(second.accumulator).toBeCloseTo(0, 10);
    });

    it('is framerate independent over a fixed span of time', () => {
        for (const fps of [15, 30, 60, 144]) {
            let acc = 0;
            let total = 0;
            for (let i = 0; i < fps; i++) {
                const step = advanceEmission(acc, 60, 1 / fps);
                acc = step.accumulator;
                total += step.count;
            }
            // 60 particles/s for one second, however it is sliced. The
            // slack is one particle: summing e.g. 144 copies of 60/144
            // lands a hair under 60 in binary floating point, which
            // withholds the last particle until the next step.
            expect(total).withContext(`at ${fps} fps`).toBeGreaterThanOrEqual(59);
            expect(total).withContext(`at ${fps} fps`).toBeLessThanOrEqual(60);
        }
    });

    it('drops the backlog after a long stall rather than dumping it', () => {
        const stalled = advanceEmission(0, 120, 10);
        expect(stalled.count).toEqual(MAX_TRAIL_PARTICLES_PER_STEP);
        // The backlog is gone, not queued for the following steps.
        expect(stalled.accumulator).toBeCloseTo(0, 10);
    });

    it('emits nothing for a zero rate or a zero delta', () => {
        expect(advanceEmission(0.9, 0, 1).count).toEqual(0);
        expect(advanceEmission(0.9, 60, 0).count).toEqual(0);
        expect(advanceEmission(0.9, 60, 0).accumulator).toEqual(0.9);
    });

    it('recovers from a non-finite accumulator instead of spreading NaN', () => {
        expect(advanceEmission(NaN, 60, 1 / 60)).toEqual({ count: 0, accumulator: 0 });
        expect(advanceEmission(NaN, 0, 1 / 60).accumulator).toEqual(0);
    });
});

describe('weaponBurst', () => {
    const config: ParticleConfig = {
        count: 2, velocity: 50, lifeMin: 32, lifeMax: 42, color: 0xff00ff,
    };

    it('halves the stored velocity, as the emitter it replaced did', () => {
        expect(weaponBurst(config).speed).toEqual(50 * PARTICLE_VELOCITY_SCALE);
        expect(PARTICLE_VELOCITY_SCALE).toEqual(0.5);
    });

    it('converts the 30 fps frame lifetimes to seconds', () => {
        const burst = weaponBurst(config);
        expect(FRAMES_PER_SECOND).toEqual(30);
        expect(burst.lifeMin).toEqual(32 / 30);
        expect(burst.lifeMax).toEqual(42 / 30);
    });

    it('keeps the weapon color, count, and additive glow', () => {
        const burst = weaponBurst(config);
        expect(burst.color).toEqual(0xff00ff);
        expect(burst.count).toEqual(2);
        expect(burst.additive).toBeTrue();
        expect(burst.alpha).toEqual(1);
    });

    it('is a point burst of constant-velocity sparks', () => {
        const burst = weaponBurst(config);
        expect(burst.speedRatio).toEqual(1);
        expect(burst.radius).toEqual(0);
        expect(burst.speedJitterMin).toEqual(1);
        expect(burst.size0).toEqual(SPARK_HALF_SIZE);
        expect(burst.size1).toEqual(SPARK_HALF_SIZE);
    });
});

describe('dustBurst', () => {
    const breakEvent = { particleCount: 25, particleColor: 0x88aa44, radius: 40 };

    it('takes its count, color, and spread from the asteroid', () => {
        const burst = dustBurst(breakEvent);
        expect(burst.count).toEqual(25);
        expect(burst.color).toEqual(0x88aa44);
        expect(burst.radius).toEqual(40);
    });

    it('drifts slowly, decelerates, shrinks, and does not glow', () => {
        const burst = dustBurst(breakEvent);
        expect(burst.speed).toEqual(12);
        expect(burst.speedRatio).toEqual(0.25);
        expect(burst.size1).toBeLessThan(burst.size0);
        expect(burst.additive).toBeFalse();
    });

    it('lingers for seconds, unlike a spark', () => {
        const burst = dustBurst(breakEvent);
        expect(burst.lifeMin).toEqual(1.5);
        expect(burst.lifeMax).toEqual(3);
    });
});

/** A GpuParticleSystem stand-in: only `spawn` is exercised by bursts. */
function fakeSystem(capacity = 64) {
    const ring = new ParticleRing(capacity);
    return {
        ring,
        spawn: (p: ParticleSpawn) => ring.spawn(p, 0),
    } as never;
}

/** A deterministic "random" that walks a fixed list, cycling. */
function scriptedRandom(values: number[]): () => number {
    let i = 0;
    return () => values[i++ % values.length];
}

describe('spawnBurst', () => {
    const burst: BurstConfig = {
        ...weaponBurst({ count: 3, velocity: 100, lifeMin: 30, lifeMax: 30, color: 0xffffff }),
    };

    it('writes exactly `count` particles by default', () => {
        const system = fakeSystem();
        spawnBurst(system, burst, 0, 0, undefined, () => 0.5);
        expect((system as any).ring.totalSpawned).toEqual(3);
    });

    it('throws a point burst from the given position', () => {
        const system = fakeSystem();
        spawnBurst(system, burst, 100, -50, 1, () => 0.5);
        expect(slotPosition((system as any).ring, 0)).toEqual({ x: 100, y: -50 });
    });

    it('scatters a dust burst inside the asteroid radius', () => {
        const system = fakeSystem();
        const dust = dustBurst({ particleCount: 1, particleColor: 0, radius: 10 });
        // angle, speed jitter, size jitter, spawn angle, spawn radius.
        spawnBurst(system, dust, 0, 0, 1, scriptedRandom([0, 1, 1, 0, 1]));
        // Spawn angle 0 at the full radius puts it on the +x edge.
        const p = slotPosition((system as any).ring, 0);
        expect(p.x).toBeCloseTo(10, 5);
        expect(p.y).toBeCloseTo(0, 5);
    });

    it('gives every particle a speed of the configured magnitude', () => {
        const system = fakeSystem();
        spawnBurst(system, burst, 0, 0, 8, Math.random);
        const ring: ParticleRing = (system as any).ring;
        for (let slot = 0; slot < 8; slot++) {
            const f = slot * FLOATS_PER_PARTICLE;
            const speed = Math.hypot(ring.floats[f + 2], ring.floats[f + 3]);
            expect(speed).toBeCloseTo(burst.speed, 3);
        }
    });

    it('picks lifetimes inside the configured range', () => {
        const system = fakeSystem();
        const wide = weaponBurst({ count: 1, velocity: 10, lifeMin: 30, lifeMax: 60, color: 0 });
        spawnBurst(system, wide, 0, 0, 16, Math.random);
        const ring: ParticleRing = (system as any).ring;
        for (let slot = 0; slot < 16; slot++) {
            const { life } = slotTime(ring, slot);
            expect(life).toBeGreaterThanOrEqual(wide.lifeMin - 1e-6);
            expect(life).toBeLessThanOrEqual(wide.lifeMax + 1e-6);
        }
    });
});

describe('spawnTrailSegment', () => {
    const burst = weaponBurst(
        { count: 1, velocity: 0, lifeMin: 30, lifeMax: 30, color: 0xffffff });

    it('spreads the step`s particles along the segment just covered', () => {
        const system = fakeSystem();
        spawnTrailSegment(system, burst, 4, 0, 0, 40, 0, () => 0.5);
        const ring: ParticleRing = (system as any).ring;
        expect(slotPosition(ring, 0).x).toBeCloseTo(10, 5);
        expect(slotPosition(ring, 1).x).toBeCloseTo(20, 5);
        expect(slotPosition(ring, 2).x).toBeCloseTo(30, 5);
        // The last one sits exactly on the projectile.
        expect(slotPosition(ring, 3).x).toBeCloseTo(40, 5);
    });

    it('lays particles behind a projectile that crossed the loop boundary', () => {
        const system = fakeSystem();
        // From just below +BOUNDARY to just above -BOUNDARY: a 20-px hop
        // across the seam, not a 19980-px sprint back across the world.
        spawnTrailSegment(system, burst, 2, 9990, 0, -9990, 0, () => 0.5);
        const ring: ParticleRing = (system as any).ring;
        expect(slotPosition(ring, 0).x).toBeCloseTo(-10000, 5);
        expect(slotPosition(ring, 1).x).toBeCloseTo(-9990, 5);
    });

    it('emits the trail rate the weapon`s particle count asks for', () => {
        // One second of a count-2 trail at the pinned emission rate.
        let acc = 0;
        let total = 0;
        for (let i = 0; i < 60; i++) {
            const step = advanceEmission(acc, 2 * TRAIL_EMIT_HZ, 1 / 60);
            acc = step.accumulator;
            total += step.count;
        }
        expect(total).toEqual(2 * TRAIL_EMIT_HZ);
    });
});
