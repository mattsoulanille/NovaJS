import { BOUNDARY, WORLD_SIZE } from "nova_ecs/datatypes/position";
import * as PIXI from "pixi.js";

/**
 * A budgeted, GPU-resident particle system.
 *
 * Every particle in the game (weapon trails, hit sparks, asteroid
 * breakup dust) is one slot in a fixed-size ring buffer of BIRTH
 * RECORDS. Nothing about a particle is stored as a JS object and nothing
 * is stepped on the CPU: a particle's whole trajectory is a closed-form
 * function of its birth record and the current time, evaluated in the
 * vertex shader. The per-frame CPU cost is therefore one uniform write
 * plus, only when something spawned, one `bufferSubData` of the slots
 * that were written.
 *
 * The motion model (matching what the old @pixi/particle-emitter configs
 * expressed) is:
 *
 *   speed(u)  = |v0| * (1 + (k - 1) * u)      linear speed ramp
 *   pos(u)    = p0 + v0 * life * (u + (k - 1) * u^2 / 2)
 *   size(u)   = mix(size0, size1, u)
 *   alpha(u)  = alpha0 * (1 - u)
 *
 * where `u = (now - birth) / life` in [0, 1] and `k` is the ratio of the
 * particle's end speed to its start speed (1 for constant-velocity
 * sparks, 0.25 for drifting dust). Positions are world coordinates; the
 * mesh is a child of the Space container, so the camera transform
 * applies, and the shader re-expresses each position as the toroidal
 * copy nearest the camera (the shader twin of `wrapNearestDelta`).
 *
 * BUDGET POLICY: the ring is the budget. Spawning past capacity
 * overwrites the OLDEST slot, so the newest effects always draw and the
 * cost per frame is constant no matter how much combat is on screen.
 *
 * Rendering is instanced quads: a unit quad (4 vertices, 6 indices)
 * drawn once per particle, with every birth record supplied as
 * per-instance attributes. Instanced quads rather than GL_POINTS on
 * purpose — ANGLE/SwiftShader cap `gl_PointSize` unpredictably, which
 * would silently change particle size depending on the driver. One draw
 * call per live block (see PARTICLE_BLOCK_SIZE); usually one or two,
 * none at all when nothing is alive.
 *
 * Slots that are unused, expired, or not yet born collapse to zero size
 * in the vertex shader, so dead particles cost a degenerate triangle
 * pair and no fragments.
 */

/** Hard cap on simultaneous particles. Also the ring buffer's length. */
export const PARTICLE_CAPACITY = 8192;

/**
 * The ring is drawn as blocks of this many slots, and a block is drawn
 * only while it still holds a live particle.
 *
 * A single instanced draw of the whole ring would cost the same whether
 * one particle is alive or eight thousand are, because an expired slot
 * still runs the vertex shader before collapsing to zero area. That is
 * free on a real GPU and NOT free on a software rasteriser: measured
 * under ANGLE/SwiftShader, drawing all 8192 instances every frame cost
 * more than the entire rest of the game (12 renders/s, against 43 with
 * the mesh hidden and 36 at 512 instances).
 *
 * Because particles are written in ring order, the live ones always
 * occupy a contiguous run of blocks, so block liveness is one `expiry`
 * number per block and the draw cost tracks the LIVE particle count
 * (rounded up to a block) rather than the budget.
 */
export const PARTICLE_BLOCK_SIZE = 256;

/**
 * Per-instance vertex layout, in bytes. One interleaved buffer so a
 * range of freshly-written slots is one contiguous upload.
 *
 *   0  aP0     vec2   birth position, world px
 *   8  aV0     vec2   birth velocity, world px/s
 *  16  aTime   vec2   (birth seconds, life seconds)
 *  24  aSize   vec2   (half-extent at birth, at death), world px
 *  32  aMisc   vec2   (end/start speed ratio, additive flag)
 *  40  aColor  4xu8   rgb + birth alpha, normalized
 */
const OFFSET_P0 = 0;
const OFFSET_V0 = 8;
const OFFSET_TIME = 16;
const OFFSET_SIZE = 24;
const OFFSET_MISC = 32;
const OFFSET_COLOR = 40;
export const PARTICLE_STRIDE_BYTES = 44;
/** Float32 slots per particle (the color word is written through a u8 view). */
const STRIDE_FLOATS = PARTICLE_STRIDE_BYTES / 4;

/** The original engine ran at 30 fps; lifetimes in the data are frames. */
export const FRAMES_PER_SECOND = 30;

const VERTEX_SRC = `
// highp, not mediump: world coordinates run to +-10000 and the clock to
// thousands of seconds. ANGLE/SwiftShader really does report a 10-bit
// mantissa for MEDIUM_FLOAT, which would snap distant particles onto an
// 8 px grid.
precision highp float;

attribute vec2 aQuad;    // unit quad corner, -1..1
attribute vec2 aP0;
attribute vec2 aV0;
attribute vec2 aTime;    // (birth, life)
attribute vec2 aSize;    // (size at birth, size at death)
attribute vec2 aMisc;    // (end/start speed ratio, additive flag)
attribute vec4 aColor;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
uniform float uTime;
uniform vec2 uCamera;

varying vec2 vQuad;
varying vec3 vColor;
varying float vAlpha;
varying float vAdditive;

void main(void) {
    float life = aTime.y;
    float age = uTime - aTime.x;
    // A dead, unborn, or never-used (life == 0) slot collapses to a
    // zero-area quad, which the rasterizer discards outright.
    float u = age / max(life, 1e-6);
    float alive = step(0.0, u) * step(u, 1.0) * step(1e-6, life);

    float k = aMisc.x;
    vec2 pos = aP0 + aV0 * life * (u + (k - 1.0) * u * u * 0.5);

    // The shader twin of wrapNearestDelta: draw at the toroidal copy of
    // the position nearest the camera so particles spawned just across
    // the loop boundary land on the near side of the seam.
    vec2 d = pos - uCamera;
    d -= ${WORLD_SIZE}.0 * sign(d) * step(${BOUNDARY}.0, abs(d));
    pos = uCamera + d;

    float size = mix(aSize.x, aSize.y, clamp(u, 0.0, 1.0)) * alive;
    vec2 world = pos + aQuad * size;

    gl_Position = vec4(
        (projectionMatrix * translationMatrix * vec3(world, 1.0)).xy, 0.0, 1.0);

    vQuad = aQuad;
    vColor = aColor.rgb;
    vAlpha = aColor.a * (1.0 - clamp(u, 0.0, 1.0)) * alive;
    vAdditive = aMisc.y;
}
`;

/**
 * Premultiplied output, so one blend mode (ONE, ONE_MINUS_SRC_ALPHA —
 * PIXI's NORMAL) covers both kinds of particle in a single draw call:
 * emitting alpha 0 for an additive particle leaves the destination
 * untouched by the `1 - srcAlpha` term, which IS additive blending.
 * That is why sparks (additive glow) and dust (ordinary alpha) can share
 * one mesh.
 */
const FRAGMENT_SRC = `
precision mediump float;

varying vec2 vQuad;
varying vec3 vColor;
varying float vAlpha;
varying float vAdditive;

void main(void) {
    // Soft disc with a SOLID core: a spark is only ~3 px across, so a
    // falloff that started at the centre would leave every one of its
    // pixels part-transparent and wash the trail out.
    float falloff = 1.0 - smoothstep(0.55, 1.0, length(vQuad));
    float a = vAlpha * falloff;
    gl_FragColor = vec4(vColor * a, a * (1.0 - vAdditive));
}
`;

/**
 * PIXI 7 types a Buffer's data as `IArrayBuffer extends ArrayBuffer`,
 * which TypeScript 5.7+ no longer accepts a typed array for (ArrayBuffer
 * grew `resizable` / `transfer` / ... members). A typed array is exactly
 * what PIXI wants at runtime, so the cast is confined to this helper.
 *
 * cast: PIXI 7's IArrayBuffer typing (see above); the one place it lives.
 */
function pixiBuffer(data: Float32Array | Uint16Array,
    isStatic: boolean, index: boolean): PIXI.Buffer {
    return new PIXI.Buffer(data as unknown as PIXI.IArrayBuffer, isStatic, index);
}

/** Everything needed to write one particle's birth record. */
export interface ParticleSpawn {
    /** World position at birth, px. */
    x: number;
    y: number;
    /** Velocity at birth, px/s. */
    vx: number;
    vy: number;
    /** Lifetime, seconds. */
    life: number;
    /** Half-extent at birth and at death, world px. */
    size0: number;
    size1: number;
    /** End speed / start speed. 1 = constant velocity, < 1 = drag. */
    speedRatio: number;
    /** 0xRRGGBB. */
    color: number;
    /** Alpha at birth; always fades linearly to 0 at death. */
    alpha: number;
    /** Additive (glowing sparks) rather than ordinary alpha (dust). */
    additive: boolean;
}

/**
 * The ring buffer of birth records: the pure, PIXI-free half of the
 * system. Owns the interleaved vertex data and the dirty range, and
 * knows nothing about how (or whether) it gets drawn.
 */
export class ParticleRing {
    readonly capacity: number;
    /** Interleaved per-instance data; PARTICLE_STRIDE_BYTES per slot. */
    readonly floats: Float32Array;
    readonly bytes: Uint8Array;

    /** The slot the next spawn will occupy. */
    private cursor = 0;
    /** Total spawns ever, for stats and for tests of wrap behaviour. */
    private spawnCount = 0;
    /** Inclusive slot range written since the last `takeDirtyRange`. */
    private dirtyLo = -1;
    private dirtyHi = -1;

    constructor(capacity = PARTICLE_CAPACITY) {
        this.capacity = capacity;
        const data = new ArrayBuffer(capacity * PARTICLE_STRIDE_BYTES);
        this.floats = new Float32Array(data);
        this.bytes = new Uint8Array(data);
    }

    /** The slot the next spawn will land in. */
    get nextSlot(): number {
        return this.cursor;
    }

    /** How many particles have ever been spawned. */
    get totalSpawned(): number {
        return this.spawnCount;
    }

    /** How many spawns have overwritten a still-occupied slot. */
    get overwritten(): number {
        return Math.max(0, this.spawnCount - this.capacity);
    }

    /**
     * Writes one birth record into the next slot and returns its index.
     * When the ring is full this silently overwrites the oldest slot —
     * that overwrite IS the budget policy.
     */
    spawn(p: ParticleSpawn, birth: number): number {
        const slot = this.cursor;
        const f = slot * STRIDE_FLOATS;
        const floats = this.floats;
        floats[f + OFFSET_P0 / 4] = p.x;
        floats[f + OFFSET_P0 / 4 + 1] = p.y;
        floats[f + OFFSET_V0 / 4] = p.vx;
        floats[f + OFFSET_V0 / 4 + 1] = p.vy;
        floats[f + OFFSET_TIME / 4] = birth;
        floats[f + OFFSET_TIME / 4 + 1] = p.life;
        floats[f + OFFSET_SIZE / 4] = p.size0;
        floats[f + OFFSET_SIZE / 4 + 1] = p.size1;
        floats[f + OFFSET_MISC / 4] = p.speedRatio;
        floats[f + OFFSET_MISC / 4 + 1] = p.additive ? 1 : 0;

        const b = slot * PARTICLE_STRIDE_BYTES + OFFSET_COLOR;
        const bytes = this.bytes;
        bytes[b] = (p.color >> 16) & 0xff;
        bytes[b + 1] = (p.color >> 8) & 0xff;
        bytes[b + 2] = p.color & 0xff;
        bytes[b + 3] = Math.max(0, Math.min(255, Math.round(p.alpha * 255)));

        this.dirtyLo = this.dirtyLo < 0 ? slot : Math.min(this.dirtyLo, slot);
        this.dirtyHi = this.dirtyHi < 0 ? slot : Math.max(this.dirtyHi, slot);
        this.cursor = (slot + 1) % this.capacity;
        this.spawnCount++;
        return slot;
    }

    /**
     * The contiguous slot range written since the last call, or null if
     * nothing was written. A batch of spawns that wrapped past the end
     * of the ring yields a range covering both pieces — correct, and
     * rare enough (once per `capacity` spawns) not to be worth two
     * uploads.
     */
    takeDirtyRange(): { start: number, count: number } | null {
        if (this.dirtyLo < 0) {
            return null;
        }
        const range = { start: this.dirtyLo, count: this.dirtyHi - this.dirtyLo + 1 };
        this.dirtyLo = -1;
        this.dirtyHi = -1;
        return range;
    }

    /** True if anything has been written since the last upload. */
    get dirty(): boolean {
        return this.dirtyLo >= 0;
    }
}

/**
 * The budget bookkeeping: a ParticleRing plus the clock and the per-block
 * expiry table that decide which blocks are worth drawing. PIXI-free, so
 * it can be exercised (and tested) without a GL context; GpuParticleSystem
 * owns one and delegates `spawn`/`stats` to it.
 */
export class ParticleBudget {
    readonly ring: ParticleRing;
    /**
     * When the newest particle written into each block dies. A block is
     * drawn only while that instant is still in the future.
     */
    private readonly blockExpiry: Float64Array;
    /** Seconds since this system was created; the shader's clock. */
    time = 0;

    constructor(capacity = PARTICLE_CAPACITY) {
        this.ring = new ParticleRing(capacity);
        this.blockExpiry =
            new Float64Array(Math.ceil(capacity / PARTICLE_BLOCK_SIZE));
    }

    get blockCount(): number {
        return this.blockExpiry.length;
    }

    /** Writes one birth record, stamped with the current clock. */
    spawn(p: ParticleSpawn): number {
        const slot = this.ring.spawn(p, this.time);
        const block = (slot / PARTICLE_BLOCK_SIZE) | 0;
        const death = this.time + p.life;
        // Landing on a block's first slot starts a fresh pass over that
        // block, so its expiry restarts from this particle instead of
        // inheriting the previous pass's (which is being overwritten).
        if (slot % PARTICLE_BLOCK_SIZE === 0 || death > this.blockExpiry[block]) {
            this.blockExpiry[block] = death;
        }
        return slot;
    }

    /** Whether this block still holds an unexpired particle. */
    isBlockLive(block: number): boolean {
        return this.blockExpiry[block] > this.time;
    }

    /** Blocks still holding at least one unexpired particle. */
    liveBlocks(): number {
        let live = 0;
        for (let block = 0; block < this.blockExpiry.length; block++) {
            if (this.blockExpiry[block] > this.time) {
                live++;
            }
        }
        return live;
    }

    /** Live counters, for debugging and for the verification harness. */
    stats() {
        const liveBlocks = this.liveBlocks();
        return {
            capacity: this.ring.capacity,
            totalSpawned: this.ring.totalSpawned,
            overwritten: this.ring.overwritten,
            nextSlot: this.ring.nextSlot,
            liveBlocks,
            /** Upper bound on live particles: what a frame actually draws. */
            drawnInstances: liveBlocks * PARTICLE_BLOCK_SIZE,
        };
    }
}

/**
 * The drawable half: a PIXI display object that renders a ParticleRing
 * as one instanced draw call.
 *
 * A bare Container subclass rather than a PIXI.Mesh: Mesh's bounds and
 * batching paths both want an `aVertexPosition` attribute describing
 * per-vertex geometry, which a fully instanced quad does not have. All
 * we want from PIXI is "bind my shader and geometry, then draw", which
 * is what `_render` does here.
 */
export class GpuParticleSystem extends PIXI.Container {
    readonly budget: ParticleBudget;
    readonly ring: ParticleRing;
    /** One geometry per block, all aliasing the same instance buffer. */
    private readonly blocks: PIXI.Geometry[] = [];
    private readonly instanceBuffer: PIXI.Buffer;
    private readonly shader: PIXI.Shader;
    private readonly state: PIXI.State;

    constructor(capacity = PARTICLE_CAPACITY) {
        super();
        this.name = 'GpuParticles';
        this.budget = new ParticleBudget(capacity);
        this.ring = this.budget.ring;

        // A unit quad and its indices, shared by every instance.
        const quad = pixiBuffer(
            new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), true, false);
        const index = pixiBuffer(
            new Uint16Array([0, 1, 2, 0, 2, 3]), true, true);
        this.instanceBuffer = pixiBuffer(this.ring.floats, false, false);

        const stride = PARTICLE_STRIDE_BYTES;
        const blockCount = this.budget.blockCount;
        for (let block = 0; block < blockCount; block++) {
            // Every block reads the same buffer from its own base byte
            // offset, so a block draws on its own with nothing duplicated.
            const base = block * PARTICLE_BLOCK_SIZE * stride;
            const geometry = new PIXI.Geometry()
                .addAttribute('aQuad', quad, 2, false, PIXI.TYPES.FLOAT)
                .addAttribute('aP0', this.instanceBuffer, 2, false,
                    PIXI.TYPES.FLOAT, stride, base + OFFSET_P0, true)
                .addAttribute('aV0', this.instanceBuffer, 2, false,
                    PIXI.TYPES.FLOAT, stride, base + OFFSET_V0, true)
                .addAttribute('aTime', this.instanceBuffer, 2, false,
                    PIXI.TYPES.FLOAT, stride, base + OFFSET_TIME, true)
                .addAttribute('aSize', this.instanceBuffer, 2, false,
                    PIXI.TYPES.FLOAT, stride, base + OFFSET_SIZE, true)
                .addAttribute('aMisc', this.instanceBuffer, 2, false,
                    PIXI.TYPES.FLOAT, stride, base + OFFSET_MISC, true)
                .addAttribute('aColor', this.instanceBuffer, 4, true,
                    PIXI.TYPES.UNSIGNED_BYTE, stride, base + OFFSET_COLOR, true)
                .addIndex(index);
            geometry.instanceCount = Math.min(PARTICLE_BLOCK_SIZE,
                capacity - block * PARTICLE_BLOCK_SIZE);
            this.blocks.push(geometry);
        }

        this.shader = PIXI.Shader.from(VERTEX_SRC, FRAGMENT_SRC, {
            uTime: 0,
            uCamera: new Float32Array([0, 0]),
        });

        this.state = PIXI.State.for2d();
        this.state.blendMode = PIXI.BLEND_MODES.NORMAL;
        this.state.depthTest = false;
    }

    /** The clock birth times are measured against, in seconds. */
    get currentTime(): number {
        return this.budget.time;
    }

    /**
     * Advances the shader clock and the camera focus. Called once per
     * frame with the display world's (wall-clock) time, so pausing and
     * tab-hiding behave exactly as they do for every other display
     * plugin.
     */
    update(timeSeconds: number, cameraX: number, cameraY: number) {
        this.budget.time = timeSeconds;
        this.shader.uniforms.uTime = timeSeconds;
        const camera = this.shader.uniforms.uCamera as Float32Array;
        camera[0] = cameraX;
        camera[1] = cameraY;
    }

    /** Writes one birth record, stamped with the current clock. */
    spawn(p: ParticleSpawn): number {
        return this.budget.spawn(p);
    }

    /** Live counters, for debugging and for the verification harness. */
    stats() {
        return this.budget.stats();
    }

    /**
     * Uploads only the slots written since the last frame. PIXI's
     * `BufferSystem.update` can only replace a whole buffer, so the
     * partial upload is done directly and the GL buffer's updateID is
     * moved forward to tell PIXI the buffer is already current.
     */
    private flush(renderer: PIXI.Renderer) {
        const range = this.ring.takeDirtyRange();
        if (!range) {
            return;
        }
        const buffer = this.instanceBuffer;
        const glBuffer = buffer._glBuffers[renderer.CONTEXT_UID];
        if (!glBuffer || glBuffer.byteLength < buffer.data.byteLength) {
            // Nothing on the GPU yet (first frame, or a lost context):
            // let PIXI do the initial full upload.
            buffer.update();
            return;
        }
        const gl = renderer.gl;
        renderer.buffer.bind(buffer);
        gl.bufferSubData(buffer.type, range.start * PARTICLE_STRIDE_BYTES,
            this.ring.bytes.subarray(
                range.start * PARTICLE_STRIDE_BYTES,
                (range.start + range.count) * PARTICLE_STRIDE_BYTES));
        glBuffer.updateID = buffer._updateID;
    }

    protected override _render(renderer: PIXI.Renderer) {
        this.flush(renderer);
        if (this.budget.liveBlocks() === 0) {
            return; // Nothing alive: not even a state change.
        }
        // Sprites batched before us must land underneath the particles.
        renderer.batch.flush();
        this.shader.uniforms.translationMatrix =
            this.transform.worldTransform.toArray(true);
        renderer.shader.bind(this.shader);
        renderer.state.set(this.state);
        for (let block = 0; block < this.blocks.length; block++) {
            if (!this.budget.isBlockLive(block)) {
                continue;
            }
            const geometry = this.blocks[block];
            renderer.geometry.bind(geometry, this.shader);
            renderer.geometry.draw(PIXI.DRAW_MODES.TRIANGLES, 6, 0,
                geometry.instanceCount);
        }
    }

    /**
     * The particle mesh has no meaningful extent of its own (its content
     * lives entirely in GPU-side attributes), and a container's bounds
     * are only ever used for culling and hit-testing, neither of which
     * applies. Left empty so `getBounds()` on an ancestor — which the
     * UI harness does walk — stays cheap and correct.
     */
    protected override _calculateBounds() { }

    override destroy(options?: boolean | PIXI.IDestroyOptions) {
        for (const geometry of this.blocks) {
            geometry.destroy();
        }
        this.shader.destroy();
        super.destroy(options);
    }
}
