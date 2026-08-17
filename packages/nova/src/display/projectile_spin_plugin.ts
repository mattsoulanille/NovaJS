import { Plugin } from "nova_ecs/plugin";
import { System } from "nova_ecs/system";
import { CreateTime } from "../nova_plugin/create_time.js";
import { ProjectileComponent, ProjectileDataComponent } from "../nova_plugin/projectile_data.js";
import { mod } from "../util/mod.js";
import { AnimationGraphicComponent, ObjectDrawSystem } from "./animation_graphic_plugin.js";
import { defaultSimulationTime, SimulationTimeResource } from "./simulation_time.js";


/**
 * 1 frame = 1/30 sec. The EVN Bible's wëap BeamWidth field counts a
 * spinning shot's frame period in "30ths of a second", the same unit the
 * fade (wëap Falloff) and damage decay use.
 */
export const SPIN_FRAME_MS = 1000 / 30;

/**
 * Which sprite frame a continuously spinning shot shows after `elapsedMs`
 * of flight, as an index in [0, frameCount), or `null` if this shot does
 * not spin — in which case the caller must leave the heading-derived
 * frame alone.
 *
 * RULE (straight from the Bible, no tunable needed). EVN Bible, wëap
 * Flags 0x0001: "Spin the weapon's graphic continuously (rate of frame
 * advance is controlled by the BeamWidth field as detailed below)"; wëap
 * BeamWidth: "For sprite-based weapons that spin continuously, this field
 * controls the time between frames, in 30ths of a second." So one sprite
 * frame lasts `spinFrameInterval * (1000/30)` ms and the cycle wraps at
 * the end of the sheet:
 *
 *     frame = floor(elapsedMs / (spinFrameInterval * SPIN_FRAME_MS))
 *             mod frameCount
 *
 * Stock nova:143 Fusion Pulse Cannon has spinFrameInterval 1 over a
 * 36-frame sheet: a frame every 1/30 s, so a full tumble every 1.2 s.
 * That is the "shots spin quite fast" look of the original, and it falls
 * out of the Bible's rate rule rather than from a fudge factor.
 *
 * Independent of heading BY DESIGN. This is the whole behavioural
 * difference the flag introduces: a normal shot's sheet holds ROTATION
 * frames and the display picks one from the shot's heading, but a
 * spinning shot's sheet is an ANIMATION cycle on a timer, and the graphic
 * then carries no heading information at all. Callers therefore also zero
 * the residual screen-space sprite rotation (see ProjectileSpinSystem);
 * keeping it would compose a heading twist onto a pre-rendered tumble.
 *
 * Returns null (rather than a frame) for the non-spinning and
 * not-yet-loaded cases so the caller can cheaply skip and leave
 * ObjectDrawSystem's heading frame in place:
 *  - `!(spinFrameInterval > 0)`: does not spin. Written as a negated
 *    positive test so a missing/NaN interval — ProjectileData rides the
 *    wire under a passthrough codec, so a snapshot predating this field
 *    would carry undefined — falls back to "no spin" instead of
 *    propagating NaN into a frame index.
 *  - `frameCount <= 0`: the sprite sheet's textures are still loading.
 *  - a non-finite `elapsedMs`: defensive, same NaN reasoning.
 *
 * Determinism: pure arithmetic plus a positive modulo — no randomness, no
 * trig, no wall clock. `elapsedMs` is the shot's sim flight time
 * (`SimulationTimeResource.time - CreateTime`), so every peer picks the
 * identical frame for the same flight time. A negative `elapsedMs` (a
 * display frame racing slightly ahead of the mirrored clock) wraps
 * through `mod` to a valid in-range frame instead of going negative.
 */
export function spinningShotFrame(spinFrameInterval: number,
    frameCount: number, elapsedMs: number): number | null {
    if (!(spinFrameInterval > 0)) {
        return null; // Not a spinning shot: heading picks the frame.
    }
    if (!(frameCount > 0)) {
        return null; // Textures still loading.
    }
    if (!Number.isFinite(elapsedMs)) {
        return null;
    }
    const frameMs = spinFrameInterval * SPIN_FRAME_MS;
    return mod(Math.floor(elapsedMs / frameMs), frameCount);
}

/**
 * Spins the sprites of shots whose wëap Flags set 0x0001, cycling their
 * frames on the sim clock instead of picking a frame from the shot's
 * heading (see {@link spinningShotFrame}).
 *
 * Runs after ObjectDrawSystem, which has just written
 * `graphic.rotation = movementState.rotation.angle` — correct for every
 * other projectile, since that maps the heading onto a rotation frame.
 * For a spinning shot this system overrides both halves of that mapping:
 * the frame (to the timed animation frame) and the residual
 * `pixiSprite.rotation` (to 0, because the tumble is pre-rendered into
 * the frames and an extra screen-space twist would compose two unrelated
 * rotations). This mirrors what TumbleDrawSystem does for pre-rendered
 * asteroid tumbles; the two never contend, since a projectile carries no
 * TumbleAnimationComponent. The `after` edge is a harmless dangling edge
 * in worlds without ObjectDrawSystem.
 *
 * Non-spinning shots (35 of the 42 stock projectile weapons), beams and
 * bays are untouched: beams have no sprite graphic at all, and any shot
 * with spinFrameInterval 0 makes `spinningShotFrame` return null before
 * anything is written, so guided missiles and rockets keep pointing where
 * they fly.
 *
 * Determinism / time source: the phase is anchored per shot at its
 * `CreateTime` (a sim-clock timestamp) and measured against the display
 * world's MIRRORED sim clock, `SimulationTimeResource` — NOT the display
 * world's own `TimeResource`, which is wall-clock epoch milliseconds and
 * would be off by ~50 years against a sim timestamp (see
 * simulation_time.ts, and the same trap ProjectileFadeSystem documents).
 * Nothing here touches simulation state: MovementState rotation, aim,
 * guidance, collision and state hashes are all unaffected.
 *
 * Phase choice: anchoring at CreateTime starts every shot at frame 0 of
 * the cycle, so a stream of shots tumbles independently rather than
 * flickering in lockstep, and it reuses the one notion of "flight time"
 * ProjectileFadeSystem already computes. The alternative — a global phase
 * from the raw sim clock, `floor(simTime / frameMs) mod frames` — is
 * equally deterministic and would make wëap Flags 0x0004 ("for cycling
 * weapons, always start on the first frame of the animation") a
 * meaningful override rather than the behaviour we always give. No stock
 * spinning weapon sets 0x0004, so the distinction is not pinned by data;
 * per-shot phase is the better-looking default of the two.
 */
export const ProjectileSpinSystem = new System({
    name: 'ProjectileSpinSystem',
    args: [ProjectileComponent, ProjectileDataComponent,
        AnimationGraphicComponent, CreateTime,
        SimulationTimeResource] as const,
    step(_projectile, projectileData, graphic, createTime, simTime) {
        const interval = projectileData.spinFrameInterval;
        if (!(interval > 0)) {
            return; // Not a spinning shot: leave the heading frame alone.
        }
        const elapsed = simTime.time - createTime;
        for (const sprite of graphic.sprites.values()) {
            // Cycle within the ACTIVE texture set, not the whole sheet.
            // For shots these coincide (a shot's animation has only a
            // 'normal' set spanning the sheet — the stock Fusion Pulse
            // Cannon's is start 0, length 36 of 36), but clamping to the
            // set keeps a plug-in multi-set shot sheet in range.
            const { start, length } = sprite.frameRange;
            const count = Math.min(length, sprite.frames);
            const frame = spinningShotFrame(interval, count, elapsed);
            if (frame === null) {
                continue;
            }
            sprite.frame = start + frame;
            sprite.pixiSprite.rotation = 0;
        }
    },
    after: [ObjectDrawSystem],
});

export const ProjectileSpinPlugin: Plugin = {
    name: 'ProjectileSpinPlugin',
    build(world) {
        // applySimulationFrame overwrites this with the sim's clock every
        // frame; until the first frame arrives the spin reads t=0 (frame
        // 0 of the cycle, so no visible glitch).
        if (!world.resources.has(SimulationTimeResource)) {
            world.resources.set(SimulationTimeResource,
                defaultSimulationTime());
        }
        world.addSystem(ProjectileSpinSystem);
    },
    remove(world) {
        world.removeSystem(ProjectileSpinSystem);
    }
};
